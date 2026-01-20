# Aura-IAC TODO

## Current Status (2026-01-20)

### Working
- [x] Controller installer (`install-controller.sh`)
- [x] Agent installer (`agent/install.sh`) - with CLI arguments
- [x] Agent registration with correct IP addresses
- [x] Single-host lab deployment via containerlab
- [x] Topology parsing strips `host` field for containerlab compatibility
- [x] JWT authentication
- [x] Database auto-creation on startup

### Not Working / Incomplete
- [ ] Multi-host deployment (nodes go to correct agents based on `host` field)
- [ ] VXLAN overlay networking between hosts
- [ ] Agent installer interactive prompts when piped through curl
- [ ] Stale agent cleanup (old registrations linger as "online")

---

## Priority 1: Multi-Host Deployment

**Goal:** When topology specifies `host: agent-name` on nodes, deploy those nodes to the specified agent.

### Current Behavior
- `host` field is stripped from topology before containerlab deploy
- All nodes deploy to a single agent (whichever is selected first)

### Required Changes

#### 1. API: Parse host assignments from topology
**File:** `api/app/main.py` (around `lab_up` function)

```python
# Pseudocode:
def lab_up():
    topology = load_topology(lab_id)

    # Group nodes by host
    nodes_by_host = {}
    for node_name, node_config in topology['nodes'].items():
        host = node_config.get('host', 'default')
        nodes_by_host.setdefault(host, []).append(node_name)

    # Deploy to each host
    for host_name, nodes in nodes_by_host.items():
        agent = get_agent_by_name(host_name)
        subset_topology = create_subset_topology(topology, nodes)
        deploy_to_agent(agent, subset_topology)

    # Set up overlay links between hosts
    setup_overlay_links(topology['links'], nodes_by_host)
```

#### 2. API: Create subset topology for each agent
**File:** `api/app/topology.py` (new function)

- Extract only the nodes assigned to a specific host
- Include only links where both endpoints are on the same host
- Cross-host links handled separately via overlay

#### 3. Agent: Wire up VXLAN overlay for cross-host links
**File:** `agent/network/overlay.py` (exists, needs integration)
**File:** `agent/main.py` (add overlay setup endpoint)

The overlay code exists but isn't called. Need to:
- Add API endpoint to create VXLAN tunnel
- Call from controller when setting up cross-host links

---

## Priority 2: Fix Agent Installer Interactive Mode

**Goal:** `curl ... | sudo bash` should prompt for agent name and controller URL

### Current Issue
Reading from `/dev/tty` doesn't work reliably when piped through curl.

### Options

1. **Require arguments when piping** (current workaround)
   ```bash
   curl ... | sudo bash -s -- --controller http://x.x.x.x:8000
   ```

2. **Download then run**
   ```bash
   curl -o install.sh ... && sudo bash install.sh
   ```

3. **Use a wrapper that handles both cases**
   Detect if stdin is a terminal and adjust behavior

**File:** `agent/install.sh`

---

## Priority 3: Fix Stale Agent Cleanup

**Goal:** Agents that stop sending heartbeats should be marked "offline"

### Current Issue
Old agent registrations persist as "online" even after the agent stops.

### Investigation Needed
- Check `agent_health_monitor()` in `api/app/main.py`
- Verify `update_stale_agents()` in `api/app/agent_client.py`
- May be a timing issue or database query bug

**Files:**
- `api/app/main.py` - health monitor task
- `api/app/agent_client.py` - `update_stale_agents()`

---

## Priority 4: Console Access via Web UI

**Goal:** WebSocket console access to nodes regardless of which host they're on

### Current Status
- Console proxy exists in `api/app/main.py` (`console_ws` function)
- Agent console handler exists in `agent/console/docker_exec.py`
- Not tested end-to-end

### Needs Testing
- Connect to node console via WebSocket
- Verify proxy works for nodes on remote agents

---

## Files Reference

### Controller/API
```
api/app/main.py           # Main API, job dispatch, console proxy
api/app/agent_client.py   # Agent communication, health checks
api/app/topology.py       # Topology parsing (graph <-> YAML)
api/app/models.py         # Database models (Host, Lab, Job, etc.)
```

### Agent
```
agent/main.py                    # Agent server, registration, heartbeat
agent/providers/containerlab.py  # Containerlab deploy/destroy
agent/network/overlay.py         # VXLAN overlay (not integrated)
agent/console/docker_exec.py     # Console access via docker exec
```

### Installers
```
install-controller.sh    # Controller installation
agent/install.sh         # Agent installation
```

---

## Test Environment

- **Host A (Controller + Agent):** 10.14.23.36
- **Host B (Agent only):** 10.14.23.11
- **SSH:** adrian / WWTwwt1!
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
