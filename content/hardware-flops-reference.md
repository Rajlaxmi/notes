---
title: Hardware FLOPs and Training-Compute Reference Sheet
slug: hardware-flops-reference
date: 2026-08-27
category: Reference
excerpt: The 6ND rule, GPT-3 as the anchor number, and dense Tensor-Core throughput for A100 → Blackwell, with worked time-to-train estimates.
tags: [hardware, gpu, flops, nvidia, training-compute, reference, cheatsheet]
authorship: ai-coauthored
---

**Contents:**

- [Monitoring GPU Utilization and Temperature](#monitoring-gpu-utilization-and-temperature)
- [Units and Notation](#units-and-notation)
- [Training FLOPs: the 6ND Rule](#training-flops-the-6nd-rule)
- [GPT-3: the Reference Point](#gpt-3-the-reference-point)
- [Nvidia Data-Center GPUs](#nvidia-data-center-gpus)
- [Putting it Together: Time-to-Train](#putting-it-together-time-to-train)
- [MFU: what you actually get](#mfu-what-you-actually-get)
- [Caveats](#caveats)

A lookup sheet for reasoning about training compute: how many FLOPs a model costs, what current accelerators deliver, and how long a run takes. GPT-3 is the number everyone quotes, so it is the worked example throughout.

## Monitoring GPU Utilization and Temperature

`nvidia-smi` ships with the driver and is the baseline tool; `nvtop` is a `htop`-style live view that's easier to read during a training run.

| Tool | Install | Use |
| --- | --- | --- |
| `nvidia-smi` | bundled with the NVIDIA driver | one-shot or polling snapshot: utilization, memory, temperature, power, clocks |
| `nvtop` | `apt install nvtop` / `brew install nvtop` | interactive, per-process, live-updating (also supports AMD/Intel GPUs) |
| `dcgm` / `dcgmi` | NVIDIA Data Center GPU Manager | fleet-level monitoring, health checks, used by DCGM Exporter → Prometheus/Grafana |
| `gpustat` | `pip install gpustat` | compact one-line-per-GPU summary, good for scripting |

```bash
nvidia-smi                          # one-shot table: util%, mem, temp, power, clock
nvidia-smi -l 1                     # refresh every 1s
watch -n 1 nvidia-smi                # same idea via watch

# a compact, scriptable line per GPU, polled every second
nvidia-smi --query-gpu=index,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,clocks.sm \
  --format=csv -l 1

nvtop                                # interactive live view, arrow keys to sort/filter
```

What to look at:

- **`utilization.gpu`** — % of the last sampling period the GPU had a kernel running. Sustained low utilization (<80%) during training usually means you're data-loading-bound, CPU-bound, or comms-bound, not compute-bound — see the MFU note below.
- **`temperature.gpu`** — data-center GPUs (A100/H100/H200/B200) throttle clocks around 85–90°C junction temp to protect silicon; sustained readings above that mean airflow/cooling is the bottleneck, not the workload.
- **`power.draw` vs board power limit** — if a GPU is pinned near its power cap but utilization is high and temps are fine, that's expected (it's compute-bound); if power draw is low while utilization is reported high, suspect a monitoring artifact or a kernel that's memory-bound rather than compute-bound.
- **`memory.used`** — creeping memory usage across steps usually means a leak (e.g. accumulating a tensor that still has `.grad` attached) rather than legitimate activation growth.
- **Per-process breakdown** (`nvidia-smi` bottom table, or `nvtop`'s process pane) — confirms which process owns the memory/utilization when multiple jobs share a box.

For a training run, the utilization column is the quick sanity check *before* computing MFU precisely: near-100% utilization with disappointing MFU points at low arithmetic intensity (small matmuls, sequence length, batch size) rather than data stalls; utilization visibly dipping between steps points at data loading or checkpointing stalls.

## Units and Notation

| Symbol | Meaning |
| --- | --- |
| FLOP | One floating-point op. A fused multiply-add (MAC) counts as **2** FLOPs. |
| FLOP/s | FLOPs per second — a *rate*. Spec sheets quote this; training cost is quoted in FLOPs, no `/s`. |
| TFLOP/s · PFLOP/s · EFLOP/s | 10¹² · 10¹⁵ · 10¹⁸ FLOP/s |
| `N` | Model parameters |
| `D` | Training tokens |
| `C` | Total training compute, in FLOPs |

One accelerator held at **1 PFLOP/s for a day = 8.64 × 10¹⁹ FLOP**. So a 10²⁴-FLOP run is ~11,600 PFLOP/s·days of work; a 10²⁵-FLOP frontier run is ~30 GPT-3s.

## Training FLOPs: the 6ND Rule

*Source: Kaplan et al., [Scaling Laws for Neural Language Models](https://arxiv.org/abs/2001.08361) (2020), §2.1; also used in [Chinchilla](https://arxiv.org/abs/2203.15556)*

For a dense transformer, compute to train on `D` tokens with `N` parameters is

$$
C \approx 6 \cdot N \cdot D
$$

| Pass | Cost | Why |
| --- | --- | --- |
| Forward | ≈ 2ND | Each parameter does one multiply-add (2 FLOPs) per token. |
| Backward | ≈ 4ND | Two matmuls the size of the forward one: grad w.r.t. inputs, grad w.r.t. weights. |

So 2 + 4 = **6 FLOPs per parameter per token**. This ignores attention's sequence-length term (negligible while `d_model ≳ seq_len`), layernorm, softmax and the embedding — all sub-10% at GPT-3 scale. Inference is forward-only, ≈ 2ND.

> **Under the hood.** The "2" is because a matmul producing `M·K` outputs over a shared inner dimension `P` does `M·K·P` multiply-adds, and each multiply-add is one `*` plus one `+`. A weight is hit once in the forward matmul (2 FLOPs/token) and appears in *two* backward matmuls — `dL/dx = dL/dy · Wᵀ` and `dL/dW = xᵀ · dL/dy` — for 4 more. Activation recomputation ("gradient checkpointing") adds roughly another 1–2ND: that surplus is counted in *hardware* FLOPs (HFU), not *model* FLOPs (MFU).

## GPT-3: the Reference Point

*Source: Brown et al., [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165) (2020), Table D.1*

| Quantity | Value |
| --- | --- |
| Parameters `N` | 1.75 × 10¹¹ (175B) |
| Training tokens `D` | 3.0 × 10¹¹ (300B) |
| 6ND estimate | 6 · 1.75e11 · 3.0e11 = 3.15 × 10²³ |
| **Reported in the paper** | **3.14 × 10²³ FLOP** (≈ 3,640 PFLOP/s·days) |
| `n_layers` / `d_model` / `n_heads` | 96 / 12288 / 96 |

**3.14e23** is the number to memorise. Everything since is measured in GPT-3s.

## Nvidia Data-Center GPUs

*Sources: NVIDIA [A100](https://www.nvidia.com/en-us/data-center/a100/), [H100](https://www.nvidia.com/en-us/data-center/h100/), [H200](https://www.nvidia.com/en-us/data-center/h200/) and [Blackwell](https://www.nvidia.com/en-us/data-center/dgx-b200/) datasheets. All figures are **dense** Tensor-Core throughput at SXM board power — the "with sparsity" marketing numbers are exactly 2×.*

| Spec (dense, SXM) | A100 80GB | H100 | H200 | B200 |
| --- | --- | --- | --- | --- |
| Architecture | Ampere | Hopper | Hopper | Blackwell |
| FP64 (Tensor Core) | 19.5 TFLOP/s | 67 TFLOP/s | 67 TFLOP/s | 40 TFLOP/s |
| TF32 Tensor Core | 156 TFLOP/s | 495 TFLOP/s | 495 TFLOP/s | 1.1 PFLOP/s |
| BF16 / FP16 Tensor Core | 312 TFLOP/s | 990 TFLOP/s | 990 TFLOP/s | 2.25 PFLOP/s |
| FP8 Tensor Core | — | 1,979 TFLOP/s | 1,979 TFLOP/s | 4.5 PFLOP/s |
| FP4 Tensor Core | — | — | — | 9 PFLOP/s |
| Memory | 80 GB HBM2e | 80 GB HBM3 | 141 GB HBM3e | 192 GB HBM3e |
| Memory bandwidth | 2.0 TB/s | 3.35 TB/s | 4.8 TB/s | ~8 TB/s |
| NVLink per GPU | 600 GB/s | 900 GB/s | 900 GB/s | 1.8 TB/s |
| Board power | 400 W | 700 W | 700 W | ~1,000 W |

- **H100 vs H200:** same compute die. H200 only adds memory capacity and bandwidth — matters for long context and inference, not peak training FLOP/s.
- **B200** is a two-die package; the column is the whole package. FP4 is inference-oriented; training uses BF16 or FP8.
- Add ~10–20% for the **GB200** superchip (higher sustained clocks in the NVL72 rack), and roughly another ~1.5× for **B300 / Blackwell Ultra**.
- PCIe cards run ~20–30% below the SXM numbers on power-capped clocks.

## Putting it Together: Time-to-Train

$$
\text{wall\_clock} \approx \frac{C}{n_{\text{gpus}} \cdot \text{peak\_FLOP/s} \cdot \text{MFU}}
$$

GPT-3 (`C` = 3.14 × 10²³), BF16, at a back-of-envelope **40% MFU**:

| Fleet | Effective FLOP/s | Time for GPT-3 |
| --- | --- | --- |
| 1 × A100 | 1.25e14 | ~80 years |
| 1 × H100 | 3.96e14 | ~25 years |
| 1,024 × A100 | 1.28e17 | ~28 days |
| 1,024 × H100 | 4.05e17 | ~9 days |
| 1,024 × B200 | 9.2e17 | ~4 days |
| 8,192 × H100 | 3.24e18 | ~27 hours |

```python
C    = 3.14e23      # GPT-3 training FLOPs = 6 * 175e9 * 300e9
peak = 989.5e12     # H100 BF16 dense FLOP/s
mfu  = 0.40         # model FLOPs utilisation
n    = 1024

days = C / (n * peak * mfu) / 86400
print(round(days, 1))   # ~9.0 days of wall clock
```

Illustrative only — real runs lose time to restarts, data stalls and eval, and the original GPT-3 run predates every part in the table.

## MFU: what you actually get

*Source: Chowdhery et al., [PaLM](https://arxiv.org/abs/2204.02311) (2022), §5; Narayanan et al., [Megatron-LM](https://arxiv.org/abs/2104.04473) (2021)*

**MFU** (Model FLOPs Utilisation) = useful 6ND FLOP/s ÷ the GPU's peak FLOP/s. **HFU** also counts recomputation, so HFU ≥ MFU.

| Regime | Typical MFU |
| --- | --- |
| Well-tuned dense pre-training, 10²–10³ GPUs | 35–55% |
| With activation recomputation | HFU 55–70%, MFU still ~40% |
| Long context / small batch / pipeline-bubble-heavy | 20–35% |
| MoE | quote FLOPs over *active* params; per-token MFU looks lower |

Rules of thumb: assume **40%** for an estimate, treat **>55%** as excellent, and read **<25%** as "bottlenecked on comms, data loading, kernel launch or load imbalance — not on math."

## Caveats

- **FLOP ≠ FLOP/s.** Cost is a count (3.14e23); hardware is a rate. Never compare the two without a time.
- **Dense vs 2:4 sparse.** Vendor slides usually show the sparse figure; halve it for real dense training.
- **Peak vs achievable.** No kernel hits peak — the MFU factor carries every estimate here.
- **6ND is the *model* estimate.** Recomputation, optimiser-state memory and MoE routing are separate line items.
- **Numbers drift.** Blackwell throughput was revised between announcement and shipping; check the current datasheet before committing a budget.
