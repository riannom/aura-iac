# Aura-IAC TODO

## Current Status (2026-01-20)

### Working
- [x] Unified installer (`install.sh`) - handles controller, agent, or both
- [x] Agent registration with correct IP addresses
- [x] Single-host lab deployment via containerlab
- [x] Topology parsing strips `host` field for containerlab compatibility
- [x] JWT authentication
- [x] Database auto-creation on startup
- [x] Multi-host deployment (nodes go to correct agents based on `host` field)
- [x] VXLAN overlay networking between hosts (tested and verified)
- [x] Unique MAC addresses for overlay interfaces (fixed 2026-01-20)

### Not Working / Incomplete
- [ ] Automatic IP assignment on overlay interfaces (manual config required)
- [ ] Stale agent cleanup (old registrations linger - use `--fresh` to reset)

---

## Priority 1: Multi-Host Deployment ✅ COMPLETE

**Goal:** When topology specifies `host: agent-name` on nodes, deploy those nodes to the specified agent.

### Implementation (Completed 2026-01-20)

The multi-host deployment is fully implemented and tested:

1. **API Detection** (`api/app/main.py`)
   - `lab_up()` analyzes topology using `analyze_topology()` from topology.py
   - If `single_host=False`, routes to `run_multihost_deploy()`
   - `lab_down()` uses `run_multihost_destroy()` for multi-host labs

2. **Topology Splitting** (`api/app/topology.py`)
   - `analyze_topology()` detects host assignments and cross-host links
   - `split_topology_by_host()` creates per-host sub-topologies
   - Cross-host links excluded from sub-topologies (handled by overlay)

3. **Multi-Host Deploy** (`api/app/main.py:run_multihost_deploy()`)
   - Maps host names in topology to registered agents via `get_agent_by_name()`
   - Deploys sub-topology to each agent in parallel
   - Sets up VXLAN overlay links for cross-host connections

4. **VXLAN Overlay** (`agent/network/overlay.py`)
   - Agent has `/overlay/tunnel`, `/overlay/attach`, `/overlay/cleanup` endpoints
   - Controller calls `setup_cross_host_link()` to create bidirectional VXLAN tunnels
   - Veth pairs use random suffixes to ensure unique MAC addresses

### Usage

Create a topology with `host:` field on nodes:

```yaml
nodes:
  r1:
    kind: linux
    image: alpine:latest
    host: local-agent
  r2:
    kind: linux
    image: alpine:latest
    host: host-b
links:
  - r1:
      ifname: eth1
    r2:
      ifname: eth1
```

The system will:
1. Deploy r1 to local-agent, r2 to host-b
2. Create VXLAN tunnel between agents (VNI auto-allocated)
3. Attach container interfaces to overlay bridge

**Note:** IPs must be configured manually on overlay interfaces:
```bash
docker exec clab-xxx-r1 ip addr add 10.0.0.1/24 dev eth1
docker exec clab-xxx-r2 ip addr add 10.0.0.2/24 dev eth1
```

---

## Priority 2: Automatic IP Assignment on Overlay Interfaces

**Goal:** Automatically assign IP addresses to cross-host link interfaces

### Current Behavior
- Overlay interfaces (eth1) are created but have no IP
- Users must manually assign IPs after deployment

### Options
1. Parse IP config from topology (if containerlab supports it)
2. Auto-assign IPs based on link index (10.0.X.1/24, 10.0.X.2/24)
3. Add IP config to topology schema

---

## Priority 3: Stale Agent Cleanup

**Goal:** Agents that stop sending heartbeats should be marked "offline"

### Current Workaround
Use `--fresh` flag to get a clean database:
```bash
curl ... | sudo bash -s -- --fresh
```

### Investigation Needed
- Check `agent_health_monitor()` in `api/app/main.py`
- Verify `update_stale_agents()` in `api/app/agent_client.py`
- May be a timing issue or database query bug

---

## Priority 4: Console Access via Web UI

**Goal:** WebSocket console access to nodes regardless of which host they're on

### Current Status
- Console proxy exists in `api/app/main.py` (`console_ws` function)
- Agent console handler exists in `agent/console/docker_exec.py`
- Not tested end-to-end

---

## Installation

### Fresh Install (Controller + Agent)

```bash
curl -fsSL https://raw.githubusercontent.com/riannom/aura-iac/main/install.sh | sudo bash
```

### Multi-Host Setup

```bash
# On controller host
curl -fsSL https://raw.githubusercontent.com/riannom/aura-iac/main/install.sh | sudo bash

# On agent hosts
curl -fsSL https://raw.githubusercontent.com/riannom/aura-iac/main/install.sh | \
  sudo bash -s -- --agent --controller-url http://CONTROLLER_IP:8000 --name host-b
```

### Clean Reinstall (resets database)

```bash
curl -fsSL https://raw.githubusercontent.com/riannom/aura-iac/main/install.sh | \
  sudo bash -s -- --fresh
```

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/riannom/aura-iac/main/install.sh | \
  sudo bash -s -- --uninstall
```

### Update Existing Installation

```bash
# Controller
cd /opt/aura-controller
sudo git pull origin main
sudo docker compose -f docker-compose.gui.yml up -d --build

# Standalone agent
cd /opt/aura-agent/repo
sudo git pull origin main
sudo systemctl restart aura-agent
```

---

## Test Environment

- **Host A (Controller + Agent):** 10.14.23.36
- **Host B (Agent only):** 10.14.23.11
- **Admin:** admin@localhost / (check /opt/aura-controller/.env)

---

## Commands Cheatsheet

```bash
# Check agents
curl -s http://localhost:8000/agents | jq '.[] | {name, address, status}'

# Login and get token
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@localhost&password=PASSWORD" | jq -r '.access_token')

# Create lab
LAB_ID=$(curl -s -X POST http://localhost:8000/labs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-lab"}' | jq -r '.id')

# Import multi-host topology
curl -s -X POST "http://localhost:8000/labs/${LAB_ID}/import-yaml" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "nodes:\n  r1:\n    kind: linux\n    image: alpine:latest\n    host: local-agent\n  r2:\n    kind: linux\n    image: alpine:latest\n    host: host-b\nlinks:\n  - r1:\n      ifname: eth1\n    r2:\n      ifname: eth1"}'

# Deploy lab
curl -s -X POST "http://localhost:8000/labs/${LAB_ID}/up" \
  -H "Authorization: Bearer $TOKEN" | jq

# Check job status
curl -s "http://localhost:8000/labs/${LAB_ID}/jobs" \
  -H "Authorization: Bearer $TOKEN" | jq '.jobs[0]'

# Destroy lab
curl -s -X POST "http://localhost:8000/labs/${LAB_ID}/down" \
  -H "Authorization: Bearer $TOKEN" | jq

# Controller logs
docker compose -f /opt/aura-controller/docker-compose.gui.yml logs -f api

# Agent logs (systemd)
journalctl -u aura-agent -f

# Agent logs (docker)
docker compose -f /opt/aura-controller/docker-compose.gui.yml logs -f agent
```

---

## Files Reference

### Unified Installer
```
install.sh                # Handles controller, agent, or both
```

### Controller/API
```
api/app/main.py           # Main API, job dispatch, multi-host orchestration
api/app/agent_client.py   # Agent communication, health checks, overlay setup
api/app/topology.py       # Topology parsing, analysis, splitting
api/app/models.py         # Database models (Host, Lab, Job, etc.)
```

### Agent
```
agent/main.py                    # Agent server, registration, heartbeat
agent/providers/containerlab.py  # Containerlab deploy/destroy
agent/network/overlay.py         # VXLAN overlay management
agent/console/docker_exec.py     # Console access via docker exec
```
