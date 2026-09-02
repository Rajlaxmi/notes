---
title: tmux Reference Sheet
slug: tmux-reference
date: 2026-09-02
category: Reference
excerpt: A quick lookup cheatsheet for tmux — sessions, windows, panes, copy mode, and the config knobs worth setting once.
tags: [tmux, terminal, shell, reference, cheatsheet, tooling]
draft: false
authorship: ai-coauthored
---

**Contents:** [Model](#the-model) · [From the Shell](#from-the-shell) · [Prefix](#the-prefix-key) · [Sessions](#sessions) · [Windows](#windows) · [Panes](#panes) · [Copy Mode](#copy-mode) · [Command Prompt](#the-command-prompt) · [Config](#config-tmux-conf) · [Scripting](#scripting-a-session) · [Gotchas](#gotchas-worth-knowing-cold)

This is a lookup sheet of the tmux commands and key bindings that come up daily when living in a terminal multiplexer. \
Official references: [tmux(1) man page](https://man7.org/linux/man-pages/man1/tmux.1.html) · [tmux GitHub wiki](https://github.com/tmux/tmux/wiki) · [Getting Started](https://github.com/tmux/tmux/wiki/Getting-Started)

Everything below assumes the default prefix `C-b` (Ctrl+b). Almost everyone rebinds it to `C-a` — see [Config](#config-tmux-conf).

### The Model

Three nested objects, from outermost to innermost:

| Object | What it is | Analogy |
| --- | --- | --- |
| **Session** | A named collection of windows. Survives a terminal closing or an SSH drop. | A project workspace |
| **Window** | One full-screen tab inside a session. Has a layout of panes. | A browser tab |
| **Pane** | One rectangular split running a single pseudo-terminal (a shell, an editor, a log tail). | A split view |

The tmux **server** starts on the first `tmux` command and holds every session in one process; **clients** attach to it. Kill the last client and the server (and your sessions) keep running until you `kill-server` or reboot.

### From the Shell

*man page: [Commands](https://man7.org/linux/man-pages/man1/tmux.1.html)*

| Command | Effect |
| --- | --- |
| `tmux` | Start a server if needed, create session `0`, attach |
| `tmux new -s work` | New session named `work` |
| `tmux new -s work -d` | Create it detached (don't attach) |
| `tmux ls` | List sessions |
| `tmux attach -t work` (`tmux a -t work`) | Attach to `work` |
| `tmux attach -d -t work` | Attach and detach any other client first |
| `tmux switch -t other` | From inside tmux, move the client to another session |
| `tmux kill-session -t work` | Kill one session |
| `tmux kill-server` | Kill everything |
| `tmux new -As work` | Attach to `work` if it exists, else create it — the idempotent one worth aliasing |

### The Prefix Key

Every tmux binding is `prefix` then a key. Press `C-b`, release, then press the command key. `C-b` `c` means "Ctrl+b, then c".

To send a literal `C-b` to the program inside the pane (e.g. Emacs, or a nested tmux), press `C-b` `C-b` if you've bound `send-prefix`, or just press it twice with the default config for a nested session after changing the inner prefix.

### Sessions

| Binding | Action |
| --- | --- |
| `prefix` `d` | Detach the current client |
| `prefix` `s` | Interactive session tree — navigate and switch |
| `prefix` `$` | Rename the current session |
| `prefix` `(` / `)` | Previous / next session |
| `prefix` `L` | Switch to the last-used session |
| `prefix` `:` `new` | New session without leaving tmux |

Detaching (`prefix` `d`) is the whole point: the session and its processes keep running on the server. Reattach later — after closing your laptop, after an SSH reconnect — with `tmux a -t <name>`.

### Windows

| Binding | Action |
| --- | --- |
| `prefix` `c` | Create a window |
| `prefix` `,` | Rename the current window |
| `prefix` `&` | Kill the current window (asks to confirm) |
| `prefix` `n` / `p` | Next / previous window |
| `prefix` `0`–`9` | Jump to window by index |
| `prefix` `w` | Interactive window+session list |
| `prefix` `f` | Find a window by name |
| `prefix` `'` | Prompt for a window index and go there |
| `prefix` `.` | Move the current window to a different index |
| `prefix` `M-n` / `M-p` | Next / previous window *with an activity or bell flag* |

`setw -g automatic-rename off` then `prefix` `,` if you want window names to stick instead of following the running command.

### Panes

*man page: [Windows and Panes](https://man7.org/linux/man-pages/man1/tmux.1.html)*

| Binding | Action |
| --- | --- |
| `prefix` `%` | Split left/right (vertical divider) |
| `prefix` `"` | Split top/bottom (horizontal divider) |
| `prefix` `o` | Cycle to the next pane |
| `prefix` `;` | Toggle to the last-active pane |
| `prefix` `←↑↓→` | Move to the pane in that direction |
| `prefix` `q` | Flash pane numbers; press one to jump |
| `prefix` `z` | Zoom the current pane to full-screen (toggle) |
| `prefix` `x` | Kill the current pane (asks to confirm) |
| `prefix` `{` / `}` | Swap the pane with the previous / next one |
| `prefix` `!` | Break the pane out into its own window |
| `prefix` `space` | Cycle through the preset layouts |
| `prefix` `M-1`…`M-5` | Apply layout: even-horizontal, even-vertical, main-horizontal, main-vertical, tiled |
| `prefix` `C-←↑↓→` | Resize the pane by 1 cell (hold to repeat) |
| `prefix` `t` | Big clock (mildly useful, mostly a party trick) |

To send one command to every pane in a window at once: `prefix` `:` `setw synchronize-panes on` (toggle it off the same way).

### Copy Mode

*wiki: [Copy Mode](https://github.com/tmux/tmux/wiki/Getting-Started#copy-mode)*

Copy mode is how you scroll the scrollback and select text with the keyboard. Enter it with `prefix` `[`. Leave it with `q` or `Enter`.

With `mode-keys vi` set (`setw -g mode-keys vi`), the selection keys mirror Vim:

| Key (in copy mode) | Action |
| --- | --- |
| `↑` `↓` / `C-u` `C-d` | Scroll line / half-page |
| `g` / `G` | Top / bottom of the buffer |
| `/` `?` then `n` `N` | Search forward / backward, repeat |
| `space` | Start the selection |
| `v` | Toggle rectangle (block) selection |
| `y` | Copy the selection and exit |
| `Enter` | Copy and exit (default binding) |
| `prefix` `]` | Paste the most recent buffer |

`prefix` `=` lists every paste buffer; `tmux show-buffer` / `tmux save-buffer -` dump the top one to stdout, which is how you get text *out* of tmux without a mouse.

For system-clipboard integration, tmux ≥ 3.2 with `set -g set-clipboard on` uses the terminal's OSC 52 escape — no `xclip` / `pbcopy` pipe needed if your terminal supports it (iTerm2, kitty, WezTerm, recent xterm do).

### The Command Prompt

`prefix` `:` opens the tmux command line. Anything in `.tmux.conf` is a command you can also run live here. Useful ones:

| Command | Effect |
| --- | --- |
| `new-window -c "#{pane_current_path}"` | New window in the current pane's directory |
| `move-window -t 3` | Renumber the current window |
| `swap-window -s 2 -t 1` | Swap two windows |
| `join-pane -s 2 -t 1` | Pull window 2 in as a pane of window 1 |
| `respawn-pane -k` | Restart the dead command in a pane |
| `clear-history` | Drop this pane's scrollback |
| `source-file ~/.tmux.conf` | Reload the config |
| `list-keys` / `list-commands` | Full binding / command reference |

### Config: `~/.tmux.conf`

*wiki: [FAQ](https://github.com/tmux/tmux/wiki/FAQ) · [Recommended defaults](https://github.com/tmux/tmux/wiki/Recommended-tweaks)*

A small, uncontroversial starting point:

```bash
# --- prefix: C-b is awkward, C-a is next to the pinky ---
unbind C-b
set -g prefix C-a
bind C-a send-prefix

# --- start counting at 1, renumber on close ---
set -g base-index 1
setw -g pane-base-index 1
set -g renumber-windows on

# --- reload without restarting ---
bind r source-file ~/.tmux.conf \; display "reloaded"

# --- splits that keep the current directory, on more memorable keys ---
bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"
bind c new-window -c "#{pane_current_path}"

# --- vi everywhere ---
setw -g mode-keys vi
bind -T copy-mode-vi v send -X begin-selection
bind -T copy-mode-vi y send -X copy-selection-and-cancel

# --- quality of life ---
set -g mouse on
set -g history-limit 50000
set -sg escape-time 10          # don't swallow <Esc> in Vim
set -g focus-events on
set -g set-clipboard on
set -g display-time 2000
```

`set` is a server/session option, `setw` (`set-window-option`) is per-window; `-g` makes either one the global default. `escape-time` defaulting to 500 ms is the single most common "Vim feels laggy inside tmux" cause — drop it to ~10.

> **Under the hood.** tmux is one server process (`tmux -S <socket>`), and every `tmux` you type is a thin client that connects over a Unix domain socket in `/tmp/tmux-<uid>/` and sends a command. `new-session` forks the server on first use; it `daemon()`s away from your terminal, which is why sessions outlive the shell that started them. Each pane is a `fork()` + `execvp()` of your `default-shell` connected to a PTY (`/dev/pts/N`); tmux is the master side, multiplexing every pane's output into the layout it draws and diffing the screen so it only writes the cells that changed. `attach-session` just points another client at an existing session and replays its current screen state. ([tmux.1](https://man7.org/linux/man-pages/man1/tmux.1.html) · [tmux design notes](https://github.com/tmux/tmux/blob/master/CHANGES))

### Scripting a Session

The reason to learn the CLI verbs: a project layout you can launch in one command. Put this in `~/bin/dev` and `chmod +x` it:

```bash
#!/usr/bin/env bash
set -euo pipefail
SESSION=${1:-dev}
ROOT=${2:-$PWD}

# Reattach if it already exists
if tmux has-session -t "$SESSION" 2>/dev/null; then
  exec tmux attach -t "$SESSION"
fi

tmux new-session  -d -s "$SESSION" -c "$ROOT" -n editor
tmux send-keys    -t "$SESSION:editor" 'nvim .' C-m

tmux new-window   -t "$SESSION" -c "$ROOT" -n server
tmux send-keys    -t "$SESSION:server" 'npm run dev' C-m

tmux new-window   -t "$SESSION" -c "$ROOT" -n shell
tmux split-window -t "$SESSION:shell" -h -c "$ROOT"
tmux select-pane  -t "$SESSION:shell.1"

tmux select-window -t "$SESSION:editor"
exec tmux attach -t "$SESSION"
```

For anything more elaborate, [tmuxp](https://github.com/tmux-python/tmuxp) and [tmuxinator](https://github.com/tmuxinator/tmuxinator) drive the same verbs from a YAML file. `send-keys ... C-m` is "type this then press Enter" — `C-m` is carriage return; `Enter` also works in modern tmux.

### Gotchas Worth Knowing Cold

- **`prefix` is release-then-press, not a chord.** `C-b c`, not `C-b-c`. Holding Ctrl for the second key does nothing useful.
- **The server keeps running with zero clients.** Your dev servers don't stop when you close the terminal — great for SSH, surprising the first time you find a process still bound to a port.
- **`kill-session` kills the processes in it.** There's no "close the tab but leave it running" — break the pane/window out first (`prefix` `!`) or detach the whole session instead.
- **Nested tmux (local + remote over SSH):** press `prefix` twice to send a command to the inner session, or give the inner one a different prefix in its `.tmux.conf`.
- **Copy mode vs. the terminal's own scrollback.** Once tmux runs, your terminal emulator's scrollbar only sees the current screen — scrollback lives in tmux (`prefix` `[`). Set a generous `history-limit`.
- **Mouse mode is a trade-off.** `set -g mouse on` gets you click-to-select-pane and wheel-scroll, but a plain drag-select now selects a tmux region, not a terminal selection — hold `Shift` to bypass tmux and use the terminal's native selection in most emulators.
- **`$TERM` inside tmux should be `screen-256color` or `tmux-256color`.** If colors look wrong in Vim, set `set -g default-terminal "tmux-256color"` and make sure that terminfo entry exists on the host.
- **Config changes aren't live.** Edit `.tmux.conf`, then `prefix` `:` `source-file ~/.tmux.conf` (or the `bind r` above). Already-open panes keep options set at creation time.
