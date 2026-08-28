---
title: CS 336 Assignment 1 — Building a Transformer LM
slug: cs336-assignment-1
date: 2026-08-28
category: Notes
excerpt: Working notes on Stanford CS336 Assignment 1 — the from-scratch Transformer LM. Pairs the method from the handout (§3 onwards) with an annotated read of my model.py.
tags: [cs336, transformers, pytorch, language-models, rope, swiglu, adamw, from-scratch]
authorship: ai-coauthored
---

**Contents:** [Setup](#the-model-in-one-paragraph) · [Conventions](#conventions-32) · [Linear & Embedding](#linear-and-embedding-33) · [RMSNorm](#rmsnorm-341) · [SwiGLU](#position-wise-feed-forward-swiglu-342) · [RoPE](#rotary-position-embeddings-343) · [Attention](#softmax-and-scaled-dot-product-attention-344) · [Multi-head](#causal-multi-head-self-attention-345) · [Full LM](#the-full-transformer-lm-35) · [FLOPs](#resource-accounting) · [Training §4](#training-the-model-4) · [Training loop §5](#training-loop-5) · [Generation §6](#generating-text-6) · [Status](#implementation-status-in-modelpy)

Notes for building a standard decoder-only Transformer language model from scratch — no `torch.nn` layers, no `torch.optim`, only `nn.Parameter`, `nn.Module` as a container, and the `Optimizer` base class. The left column is the method as the handout defines it from **Section 3 onwards**; the right column is what `cs336_basics/model.py` currently does.

### The model in one paragraph

A language model maps a batch of token IDs `(batch_size, seq_len)` to a distribution over the next token, `(batch_size, seq_len, vocab_size)`. Training minimises cross-entropy against the actual next token; generation takes the last position's distribution and samples. The architecture is: **token embedding → `num_layers` pre-norm Transformer blocks → final RMSNorm → linear LM head**. Each block is two pre-norm sub-layers with residual connections:

```
y = x + MultiHeadSelfAttention(RMSNorm(x))
z = y + SwiGLU(RMSNorm(y))
```

Reference config used throughout the handout (GPT-2 XL shape):

| Hyperparameter | Value |
| --- | --- |
| `vocab_size` | 50,257 |
| `context_length` | 1,024 |
| `num_layers` | 48 |
| `d_model` | 1,600 |
| `num_heads` | 25 |
| `d_ff` | 4,288 (nearest multiple of 64 to `8/3 · d_model`) |

### Conventions (§3.2)

- **Column vectors in the math, row-major in code.** The handout writes `y = Wx`; PyTorch stores row-major, so a linear layer is `y = x @ W.T`. If you use einsum and label axes correctly this is a non-issue.
- **Batch-like dimensions come first and are broadcast over.** Every position-wise op (RMSNorm, FFN) and the per-head attention op should tolerate arbitrary leading dims `(..., seq_len, d)`.
- **einsum notation** (`einops.einsum` / `einx`) is recommended over `view`/`reshape`/`transpose` chains — it is self-documenting about tensor shapes.
- The matmul primitive for cost accounting: `A @ B` with `A ∈ ℝ^{m×n}`, `B ∈ ℝ^{n×p}` costs **`2mnp` FLOPs**.

### Linear and Embedding (§3.3)

**Initialisation** (the handout's approximate recipe, `torch.nn.init.trunc_normal_`):

| Parameter | Distribution |
| --- | --- |
| Linear weights | `N(0, σ² = 2/(d_in + d_out))`, truncated at `[−3σ, 3σ]` |
| Embeddings | `N(0, 1)`, truncated at `[−3, 3]` |
| RMSNorm gain | `1` |

**`Linear`** — no bias, following modern LLMs. Store the parameter as `W` with shape `(out_features, in_features)` (not `Wᵀ`), inside an `nn.Parameter`.

```python
class Linear(nn.Module):
    def __init__(self, in_features, out_features, device=None, dtype=None):
        super().__init__()
        self.W = nn.Parameter(torch.empty(out_features, in_features, device=device, dtype=dtype))
        self._initialize(self.W)

    def _initialize(self, W):
        std = 2 / (self.in_features + self.out_features)
        nn.init.trunc_normal_(W, mean=0, std=std, a=-3*std, b=3*std)

    def forward(self, x):
        return x @ self.W.T
```

**`Embedding`** — a lookup, not a matmul: index the `(vocab_size, d_model)` table with a `LongTensor` of IDs shaped `(batch_size, seq_len)`. `d_model` is the last dimension. `model.py` initialises with `mean=0, std=1, a=-3, b=3`, matching the spec exactly.

```python
def forward(self, token_ids):
    return self.embeddings[token_ids]
```

> **Under the hood.** The spec says variance `σ² = 2/(d_in + d_out)` and truncation at `±3σ`. `model.py` passes `2/(d_in + d_out)` straight into `std=` (and into the `a`/`b` bounds), i.e. it uses the *variance* where `trunc_normal_` expects the *standard deviation*. To match the handout it should be `std = math.sqrt(2 / (in_features + out_features))` with `a=-3*std, b=3*std`. Pre-norm Transformers are famously robust to init, so tests still pass, but the sampled scale is off. Embedding init is unaffected (`σ = σ² = 1`).

### RMSNorm (§3.4.1)

Replaces LayerNorm. For an activation vector `a ∈ ℝ^{d_model}` with learnable gain `g`:

```
RMSNorm(a)_i = a_i / RMS(a) · g_i        RMS(a) = sqrt( (1/d_model) Σ a_i²  +  ε )
```

`ε` is fixed at `1e-5` and lives *inside* the square root. Upcast to `float32` before squaring to avoid overflow, then downcast the result to the input dtype. `model.py` follows this precisely:

```python
def forward(self, x):
    in_dtype = x.dtype
    x_upcast = x.to(dtype=torch.float32)
    rms_multiple = 1 / torch.sqrt((1/self.d_model) * torch.sum(x_upcast**2, dim=-1, keepdim=True) + self.eps)
    x_norm = x_upcast * rms_multiple * self.gain
    return x_norm.to(dtype=in_dtype)
```

`gain` is a `d_model`-length `nn.Parameter` initialised to ones.

### Position-wise feed-forward: SwiGLU (§3.4.2)

Modern FFN = SiLU activation + a gating branch (GLU), no bias:

```
SiLU(x)   = x · σ(x) = x / (1 + e^{−x})
FFN(x)    = SwiGLU(x, W1, W2, W3) = W2 ( SiLU(W1 x) ⊙ W3 x )
```

Shapes: `W1, W3 ∈ ℝ^{d_ff × d_model}`, `W2 ∈ ℝ^{d_model × d_ff}`. Canonically `d_ff = 8/3 · d_model`, rounded to a multiple of 64 for hardware efficiency.

```python
class SwiGLU(nn.Module):
    def __init__(self, d_model, d_ff, device=None, dtype=None):
        self.W1 = Linear(d_model, d_ff)
        self.W3 = Linear(d_model, d_ff)
        self.W2 = Linear(d_ff, d_model)

    def forward(self, x):
        swish_out = SiLU()(self.W1(x))
        glu_out = self.W2(swish_out * self.W3(x))
        return glu_out
```

> **Under the hood.** `model.py` has a `round_up_to_64` helper on the class but `__init__` takes `d_ff` as given and never calls it — the `8/3 · d_model` → multiple-of-64 rounding is left to the caller. The handout also permits `torch.sigmoid` for SiLU for numerical stability; `model.py` spells it out as `x / (1 + torch.exp(-x))`, which underflows to `0` for large negative `x` (the correct limit) but is less clean.

### Rotary position embeddings (§3.4.3)

RoPE injects position by rotating pairs of query/key channels. For query `q^(i)` at position `i`, dimension pair `k ∈ {1, …, d/2}`:

```
θ_{i,k} = i / Θ^{(2k−2)/d}

R_k^i = [ cos θ_{i,k}   −sin θ_{i,k} ]
        [ sin θ_{i,k}    cos θ_{i,k} ]
```

The full `R^i` is block-diagonal with those 2×2 blocks. Key facts that make it cheap:

- **No learnable parameters.** Precompute `cos`/`sin` once into a buffer via `register_buffer(..., persistent=False)`.
- Applied to **queries and keys only**, never values.
- The **head dimension is a batch dimension** — the same rotation is applied per head.
- Reused across layers and batches; only depends on position and channel.

```python
class RotaryPositionalEmbedding(nn.Module):
    def __init__(self, theta, d_k, max_seq_len, device=None):
        inv_freq = 1.0 / (theta ** (torch.arange(0, d_k, 2, device=device).float() / d_k))
        angles = torch.outer(torch.arange(max_seq_len, device=device), inv_freq)
        cos_sin = torch.stack([torch.cos(angles), torch.sin(angles)])
        self.register_buffer("cos_sin", cos_sin, persistent=False)

    def forward(self, x, token_positions):
        cos = self.cos_sin[0][token_positions]
        sin = self.cos_sin[1][token_positions]
        x1, x2 = x[..., 0::2], x[..., 1::2]
        rotated_x1 = x1 * cos - x2 * sin
        rotated_x2 = x1 * sin + x2 * cos
        out = torch.stack([rotated_x1, rotated_x2], dim=-1).flatten(start_dim=-2)
        return out
```

`token_positions` has shape `(..., seq_len)` and indexes the precomputed table; `cos`/`sin` then broadcast against `x`'s leading batch/head dims. The `0::2` / `1::2` split takes adjacent channel pairs, and `stack(...).flatten(-2)` re-interleaves them in the same order.

### Softmax and scaled dot-product attention (§3.4.4)

**Softmax** — subtract the max along the reduction dim for numerical stability (`exp` of a large value is `inf`, and `inf/inf = NaN`):

```python
def softmax(x, dim=-1):
    x_max = torch.amax(x, dim=dim, keepdim=True)
    exp_x = torch.exp(x - x_max)
    return exp_x / torch.sum(exp_x, dim=dim, keepdim=True)
```

**Attention:**

```
Attention(Q, K, V) = softmax( Q Kᵀ / sqrt(d_k) ) V
```

with `Q ∈ ℝ^{n×d_k}`, `K ∈ ℝ^{m×d_k}`, `V ∈ ℝ^{m×d_v}` — none learnable here. **Masking convention:** a boolean mask `M ∈ {True, False}^{n×m}`; `True` at `(i, j)` means query `i` *may* attend to key `j`. Implement by adding `−∞` to the pre-softmax scores wherever the mask is `False` (cheaper than slicing subsequences).

```python
class ScaledDotProductAttention(nn.Module):
    def forward(self, Q, K, V, mask=None):
        d_k = Q.shape[-1]
        scores = Q @ K.transpose(-2, -1) / math.sqrt(d_k)
        if mask is not None:
            scores = scores.masked_fill(~mask, float("-inf"))
        return softmax(scores) @ V
```

Must handle arbitrary leading batch dims on `Q`/`K`/`V` and an optional `(seq_len, seq_len)` mask.

### Causal multi-head self-attention (§3.4.5)

```
MultiHead(Q, K, V) = Concat(head_1, …, head_h) with head_i = Attention(Q_i, K_i, V_i)
MultiHeadSelfAttention(x) = W_O · MultiHead(W_Q x, W_K x, W_V x)
```

- `d_k = d_v = d_model / num_heads`.
- Learnable parameters: `W_Q, W_K, W_V ∈ ℝ^{h·d_k × d_model}` and `W_O ∈ ℝ^{d_model × h·d_v}` — three projection matmuls plus the output projection. (Stretch: fuse `W_Q/W_K/W_V` into one matmul.)
- **Causal mask:** token `i` attends only to `j ≤ i`. Build with `torch.triu` or a broadcasted index comparison and pass it into the scaled-dot-product attention from §3.4.4 — reuse, don't loop over prefixes.
- **RoPE** is applied to `Q` and `K` after projection, per head, before the dot product.

`model.py` status: `MultiHeadAttention` is a bare stub (`def forward(self): pass`). Everything it depends on — projections (`Linear`), `RotaryPositionalEmbedding`, `ScaledDotProductAttention`, `softmax` — is in place.

### The full Transformer LM (§3.5)

Assemble a block (refer to Figure 2 in the handout):

```
y = x + MultiHeadSelfAttention(RMSNorm(x))     # sub-layer 1
z = y + SwiGLU(RMSNorm(y))                      # sub-layer 2
```

Then the whole model: `token embedding → num_layers blocks → final RMSNorm → Linear LM head → logits over vocab`. Constructor parameters: `vocab_size`, `context_length` (sizes the RoPE buffer), `num_layers`, `d_model`, `num_heads`, `d_ff`. Not yet present in `model.py`.

### Resource accounting

Method for the `transformer_accounting` problem:

1. Write down **every matmul** in a forward pass.
2. Convert each to FLOPs with the `2mnp` rule.

Findings the handout is steering you toward: parameter count and memory (`4 · N` bytes in fp32 to load), the forward-pass FLOP total for the GPT-2 XL shape, that the token↔vocab projections and the FFN dominate, and how the balance between attention and FFN shifts with `d_model` and with context length.

---

## Training the model (§4)

### Cross-entropy loss (§4.1)

For logits `o_i ∈ ℝ^{vocab_size}` at position `i` and target `x_{i+1}`:

```
ℓ_i = −log softmax(o_i)[x_{i+1}]
ℓ(θ; D) = (1 / |D|m) Σ_x Σ_i ℓ_i
```

Implementation care: subtract the max logit for stability; **cancel the `log` and `exp` analytically** (`log softmax` = `o[target] − logsumexp(o)`), don't compose the two ops; average over all leading batch dims, which come before the vocab dim.

**Perplexity** (eval metric): `perplexity = exp( (1/m) Σ ℓ_i )`.

### SGD, then AdamW (§4.2–4.3)

An `Optimizer` subclass implements `__init__(self, params, ...)` (pass defaults up to `super().__init__`) and `step(self)` (mutate `p.data` in place using `p.grad.data`; per-parameter state lives in `self.state[p]`).

**AdamW** (Algorithm 1 — decoupled weight decay, `t` starts at 1):

```
g   ← ∇ ℓ(θ; B_t)
α_t ← α · sqrt(1 − β₂^t) / (1 − β₁^t)      # bias-corrected step size
θ   ← θ − α · λ · θ                        # weight decay, decoupled from the grad
m   ← β₁ m + (1 − β₁) g                    # first moment
v   ← β₂ v + (1 − β₂) g²                   # second moment
θ   ← θ − α_t · m / (sqrt(v) + ε)          # update
```

Typical `(β₁, β₂) = (0.9, 0.999)`; LLMs often use `(0.9, 0.95)`. `ε ≈ 1e-8`. AdamW is stateful — two extra tensors (`m`, `v`) per parameter, which is the bulk of the `adamw_accounting` memory analysis (parameters + gradients + optimizer state + activations).

### Cosine learning-rate schedule (§4.4)

A schedule is a pure function of step `t`. Cosine annealing with warmup, given `α_max`, `α_min`, warmup steps `T_w`, cosine end `T_c`:

```
t < T_w         :  α_t = (t / T_w) · α_max
T_w ≤ t ≤ T_c   :  α_t = α_min + ½ (1 + cos( (t − T_w)/(T_c − T_w) · π )) (α_max − α_min)
t > T_c         :  α_t = α_min
```

### Gradient clipping (§4.5)

After `backward()`, before `step()`: compute the global `ℓ₂` norm `‖g‖₂` over all parameter grads. If `‖g‖₂ ≥ M`, scale every grad by `M / (‖g‖₂ + ε)` with `ε = 1e-6`. Resulting norm sits just under `M`.

---

## Training loop (§5)

### Data loader (§5.1)

Input: a 1-D numpy array `x` of token IDs, `batch_size`, `context_length`, device string. Output: a pair of `(batch_size, context_length)` `LongTensor`s — sampled input windows and their next-token targets — on the requested device. Any start index `1 ≤ i ≤ n − context_length` is a valid training sequence, so sampling is trivial and no padding is needed. For datasets that don't fit in RAM, load with `np.memmap` / `mmap_mode='r'` and a matching `dtype` (token IDs serialise well as `uint16` when `vocab_size < 65536`).

### Checkpointing (§5.2)

- `save_checkpoint(model, optimizer, iteration, out)` → `torch.save` a dict of `model.state_dict()`, `optimizer.state_dict()`, and `iteration` to `out` (path or file-like).
- `load_checkpoint(src, model, optimizer)` → `torch.load`, restore both via `load_state_dict`, return the saved `iteration`.

A resumable checkpoint needs model weights **and** optimizer moments **and** the step number (so the LR schedule resumes correctly).

### Training script (§5.3)

Put it together into a configurable script: CLI-controlled model/optimizer hyperparameters, memory-mapped train/val loading, checkpoint to a user path, periodic train/val loss logging against both step count and wall-clock time.

---

## Generating text (§6)

Decode one token at a time from a prompt `x_{1…t}`:

```
v = TransformerLM(x_{1…t})_t ∈ ℝ^{vocab_size}      # logits at the last position
P(x_{t+1} = i | x_{1…t}) = softmax(v)_i
```

Append the sampled token, repeat until `<|endoftext|>` or a max length. Two decoder tricks for small models:

- **Temperature scaling:** `softmax(v, τ)_i = exp(v_i/τ) / Σ_j exp(v_j/τ)`. `τ → 0` makes it argmax (one-hot); `τ > 1` flattens.
- **Top-p / nucleus sampling:** keep the smallest set `V(p)` of tokens with cumulative probability `≥ p`, zero the rest, renormalise. Compute by sorting `q` descending and taking the prefix that reaches `p`.

---

## Implementation status in `model.py`

| Component | §    | Status |
| --- | --- | --- |
| `Linear` (no bias) | 3.3 | Done — init passes variance where std is expected (see note) |
| `Embedding` | 3.3 | Done, init matches spec |
| `RMSNorm` (fp32 upcast, `ε` inside sqrt) | 3.4.1 | Done |
| `SiLU` / `SwiGLU` | 3.4.2 | Done — `d_ff` rounding left to caller; `round_up_to_64` unused |
| `RotaryPositionalEmbedding` | 3.4.3 | Done — precomputed non-persistent buffer, interleaved pairs |
| `softmax` (max-subtraction) | 3.4.4 | Done |
| `ScaledDotProductAttention` (bool mask → `−inf`) | 3.4.4 | Done |
| `MultiHeadAttention` | 3.4.5 | **Stub** — `forward` is `pass` |
| Transformer block | 3.5 | Not started |
| `TransformerLM` | 3.5 | Not started |
| Cross-entropy, AdamW, LR schedule, clipping | 4 | Not in this file |
| Data loader, checkpointing, training loop | 5 | Not in this file |
| Decoding (temperature, top-p) | 6 | Not in this file |
