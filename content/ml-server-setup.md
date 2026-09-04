---
title: ML Server Setup
slug: ml-server-setup
date: 2026-09-02
category: Reference
excerpt: Renting a GPU box on vast.ai and getting a training job running on it — the short version.
tags: [vast-ai, gpu, cloud, ssh, pytorch, training-compute, reference, tooling]
draft: false
authorship: ai-coauthored
---

Standing up a single-GPU box on [vast.ai](https://vast.ai) for training work. \
References: [docs](https://docs.vast.ai/) · [CLI](https://docs.vast.ai/cli) · [console](https://cloud.vast.ai/)

### vast.ai server setup

One-time: sign up, add credit, create an **API key**, and paste your **public SSH key** (both under **Account**). Then:

```bash
pipx install vastai                 # or: pip install --upgrade vastai
vastai set api-key <key>            # stored at ~/.config/vastai/vast_api_key
vastai show instances               # sanity check — 401 = bad/stale key

# find a machine: cheap, reliable, enough disk + bandwidth, CUDA new enough
vastai search offers 'gpu_name=RTX_4090 num_gpus=1 rentable=true \
  cuda_vers>=12.1 inet_down>=200 disk_space>=60 reliability>0.98' -o 'dph+'

# rent the offer id from column 1
vastai create instance <id> --image pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime \
  --disk 60 --ssh --direct --onstart-cmd 'touch ~/.no_auto_tmux'

vastai show instances            # wait for running
vastai ssh-url <id>              # ssh://root@host:port  → add to ~/.ssh/config as `vast`
```

### SSH into a running instance

```bash
vastai ssh-url <id>                       # → ssh://root@<ip>:<port>  (direct)
ssh -p <port> root@<ip>                   # user is always root

# deriving host/port by hand from the instance JSON:
vastai show instances --raw | python3 -m json.tool
#   .public_ipaddr            → host IP        (direct)
#   .ports["22/tcp"][0].HostPort → SSH port    (direct)
#   .ssh_host + .ssh_port     → Vast SSH proxy (use if direct ports are firewalled)
```

### Use it

```bash
ssh vast
tmux new -As train                                   # survive SSH drops — see the tmux sheet
tmux set -g mouse on                                  # scroll + click-to-select panes over SSH
cd /workspace && git clone <repo> && cd <repo>       # /workspace persists across stop/start
# pull datasets HERE (s3/HF), not from home — the box has the bandwidth
uv sync && uv run python -c 'import torch; print(torch.cuda.is_available())'   # must be True
uv run python -m train --out /workspace/<repo>/out 2>&1 | tee out/train.log
# C-a d to detach; watch -n2 nvidia-smi and df -h /workspace from another pane
```

### VS Code on the box

Edit code on the remote with the full VS Code UI. Two ways in:

```bash
# Option A: Remote-SSH — reuses the `vast` host from ~/.ssh/config
#   VS Code → Cmd-Shift-P → "Remote-SSH: Connect to Host" → vast
#   first connect auto-installs the server under ~/.vscode-server on the box

# Option B: tunnel — no port forwarding, works behind the Vast SSH proxy
ssh vast && cd /workspace
curl -Lk 'https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64' -o vscode-cli.tar.gz
tar xf vscode-cli.tar.gz
tmux new -As code './code tunnel --accept-server-license-terms --name vast-gpu'
#   → auth via github.com/login/device, then open https://vscode.dev/tunnel/vast-gpu/workspace
```

- Run the tunnel inside tmux (above) so it outlives the SSH session.
- Install the CLI + extensions under `/workspace` so they survive stop/start; both are gone after `destroy`.
- Extensions run on the remote — reinstall Python/Pylance on first connect.
- The server adds ~1 GB RAM and steady CPU; `./code tunnel unregister` before `stop` for a clean restart.

### Teardown

`stop instance` halts GPU billing but **storage still bills** until `destroy instance`, which is irreversible with no snapshot. Copy results down first:

```bash
vastai scp <id> :/workspace/<repo>/out ./out-$(date +%F)
vastai destroy instance <id> && vastai show instances
```

### Gotchas

- Image CUDA must be ≤ the host's `cuda_max_good`, or `torch.cuda.is_available()` is `False`.
- Interruptible instances are evicted mid-step with no warning — on-demand unless you checkpoint often.
- Stopped instances keep billing for disk; check `vastai show instances` for zombies.
- `--disk` can't grow reliably later — size it for dataset + all checkpoints up front.
- Low `inet_down` or `reliability < 0.98` is a false economy on any run over an hour.
