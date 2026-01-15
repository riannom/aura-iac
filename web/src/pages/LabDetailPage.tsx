import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import ReactFlow, {
  Background,
  Connection,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  Position,
  ReactFlowInstance,
  addEdge,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { API_BASE_URL, apiRequest } from "../api";
import { GraphLink, GraphNode, TopologyGraph } from "../types";

interface Lab {
  id: string;
  name: string;
  created_at: string;
}

interface DeviceCatalogEntry {
  id: string;
  label: string;
  support?: string;
}

interface ImageCatalogEntry {
  clab?: string;
  libvirt?: string;
  virtualbox?: string;
  caveats?: string[];
}

interface NodeData {
  label: string;
  device?: string;
  version?: string;
  image?: string;
}

interface LinkData {
  name?: string;
  type?: string;
  pool?: string;
  prefix?: string;
}

const fallbackPalette: DeviceCatalogEntry[] = [
  { id: "iosv", label: "Cisco IOSv" },
  { id: "csr", label: "Cisco CSR" },
  { id: "frr", label: "FRR" },
];

function isSwitchDevice(deviceId: string | undefined) {
  if (!deviceId) return false;
  return deviceId.includes("l2") || deviceId.includes("switch");
}

function DeviceNode({
  data,
  selected,
}: {
  data: NodeData;
  selected: boolean;
}) {
  const icon = isSwitchDevice(data.device) ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="device-icon">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="7.5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="16.5" cy="12" r="1.2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="device-icon">
      <rect x="4" y="5" width="16" height="6" rx="2" />
      <rect x="4" y="13" width="16" height="6" rx="2" />
      <path d="M8 11.5h8M8 13.5h8" strokeWidth="1.2" />
    </svg>
  );

  return (
    <div className={`device-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="device-node-body">
        {icon}
        <div className="device-node-text">
          <strong>{data.label || "Device"}</strong>
          <span>{data.device || "unknown"}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function flowFromGraph(graph: TopologyGraph): { nodes: Node<NodeData>[]; edges: Edge<LinkData>[] } {
  const nodes = graph.nodes.map((node, index) => ({
    id: node.id || node.name,
    type: "device",
    position: { x: 80 + (index % 4) * 180, y: 80 + Math.floor(index / 4) * 140 },
    data: {
      label: (node.vars as any)?.label || node.name,
      device: node.device || "",
      version: node.version || "",
      image: node.image || "",
    },
  }));

  const edges: Edge<LinkData>[] = [];
  graph.links.forEach((link, linkIndex) => {
    if (link.endpoints.length < 2) {
      return;
    }
    const [first, ...rest] = link.endpoints;
    rest.forEach((endpoint) => {
      edges.push({
        id: `link-${linkIndex}-${first.node}-${endpoint.node}`,
        source: first.node,
        target: endpoint.node,
        label: link.name || "",
        data: {
          name: link.name || "",
          type: link.type || "",
          pool: link.pool || "",
          prefix: link.prefix || "",
        },
      });
    });
  });

  return { nodes, edges };
}

function graphFromFlow(nodes: Node<NodeData>[], edges: Edge<LinkData>[]): TopologyGraph {
  const graphNodes: GraphNode[] = nodes.map((node) => ({
    id: node.id,
    name: node.id,
    device: node.data.device || null,
    version: node.data.version || null,
    image: node.data.image || null,
    vars:
      node.data.label && node.data.label !== node.id
        ? { label: node.data.label }
        : null,
  }));

  const graphLinks: GraphLink[] = edges.map((edge) => ({
    endpoints: [{ node: edge.source }, { node: edge.target }],
    name: edge.data?.name || edge.label?.toString() || null,
    type: edge.data?.type || null,
    pool: edge.data?.pool || null,
    prefix: edge.data?.prefix || null,
  }));

  return { nodes: graphNodes, links: graphLinks, defaults: { device: "iosv" } };
}

export function LabDetailPage() {
  const { labId } = useParams();
  const [lab, setLab] = useState<Lab | null>(null);
  const [yaml, setYaml] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [runtimeLog, setRuntimeLog] = useState<string>("");
  const [jobs, setJobs] = useState<any[]>([]);
  const [consoleOutput, setConsoleOutput] = useState<string>("");
  const [consoleInput, setConsoleInput] = useState<string>("");
  const [deviceLog, setDeviceLog] = useState<string>("");
  const consoleSocket = useRef<WebSocket | null>(null);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [shareEmail, setShareEmail] = useState<string>("");
  const [shareRole, setShareRole] = useState<string>("viewer");
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [deviceCatalog, setDeviceCatalog] = useState<DeviceCatalogEntry[]>([]);
  const [imageCatalog, setImageCatalog] = useState<Record<string, ImageCatalogEntry>>({});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);

  const reactFlowWrapper = useRef<HTMLDivElement | null>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LinkData>([]);

  const nodeTypes = useMemo(() => ({ device: DeviceNode }), []);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) || null,
    [edges, selectedEdgeId]
  );

  function renderDeviceIcon(deviceId: string) {
    if (isSwitchDevice(deviceId)) {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="device-icon">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="7.5" cy="12" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="16.5" cy="12" r="1.2" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="device-icon">
        <rect x="4" y="5" width="16" height="6" rx="2" />
        <rect x="4" y="13" width="16" height="6" rx="2" />
        <path d="M8 11.5h8M8 13.5h8" strokeWidth="1.2" />
      </svg>
    );
  }

  async function loadLab() {
    if (!labId) return;
    const data = await apiRequest<Lab>(`/labs/${labId}`);
    setLab(data);
    const yamlData = await apiRequest<{ content: string }>(`/labs/${labId}/export-yaml`);
    setYaml(yamlData.content);
    await loadGraph();
    await loadDevices();
    await loadImages();
    loadJobs();
    loadPermissions();
  }

  async function loadDevices() {
    try {
      const data = await apiRequest<{ devices?: DeviceCatalogEntry[] }>("/devices");
      setDeviceCatalog(data.devices || []);
    } catch {
      setDeviceCatalog([]);
    }
  }

  async function loadImages() {
    try {
      const data = await apiRequest<{ images?: Record<string, ImageCatalogEntry> }>("/images");
      setImageCatalog(data.images || {});
    } catch {
      setImageCatalog({});
    }
  }

  async function loadGraph() {
    if (!labId) return;
    const graph = await apiRequest<TopologyGraph>(`/labs/${labId}/export-graph`);
    const flow = flowFromGraph(graph);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }

  async function exportYaml() {
    if (!labId) return;
    const data = await apiRequest<{ content: string }>(`/labs/${labId}/export-yaml`);
    const blob = new Blob([data.content], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${lab?.name || "topology"}.yaml`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function saveGraph() {
    if (!labId) return;
    const graph = graphFromFlow(nodes, edges);
    await apiRequest(`/labs/${labId}/import-graph`, {
      method: "POST",
      body: JSON.stringify(graph),
    });
    const yamlData = await apiRequest<{ content: string }>(`/labs/${labId}/export-yaml`);
    setYaml(yamlData.content);
    setStatus("Canvas saved to YAML");
  }

  async function loadJobs() {
    if (!labId) return;
    const data = await apiRequest<{ jobs: any[] }>(`/labs/${labId}/jobs`);
    setJobs(data.jobs);
  }

  async function runAction(action: "up" | "down" | "restart") {
    if (!labId) return;
    await apiRequest(`/labs/${labId}/${action}`, { method: "POST" });
    loadJobs();
  }

  async function fetchStatus() {
    if (!labId) return;
    const data = await apiRequest<{ raw: string }>(`/labs/${labId}/status`);
    setRuntimeLog(data.raw);
  }

  async function loadLatestLog() {
    if (!labId || jobs.length === 0) return;
    const jobId = jobs[0].id;
    const data = await apiRequest<{ log: string }>(`/labs/${labId}/jobs/${jobId}/log?tail=200`);
    setRuntimeLog(data.log);
  }

  async function loadNodeActionLog() {
    if (!labId || !selectedNode) return;
    const nodeName = selectedNode.id;
    const job = jobs.find(
      (item) => typeof item.action === "string" && item.action.startsWith("node:") && item.action.endsWith(`:${nodeName}`)
    );
    if (!job) {
      setDeviceLog("No node action logs found yet.");
      return;
    }
    const data = await apiRequest<{ log: string }>(`/labs/${labId}/jobs/${job.id}/log?tail=200`);
    setDeviceLog(data.log);
  }

  async function loadPermissions() {
    if (!labId) return;
    const data = await apiRequest<{ permissions: any[] }>(`/labs/${labId}/permissions`);
    setPermissions(data.permissions);
  }

  async function shareLab() {
    if (!labId || !shareEmail) return;
    await apiRequest(`/labs/${labId}/permissions`, {
      method: "POST",
      body: JSON.stringify({ user_email: shareEmail, role: shareRole }),
    });
    setShareEmail("");
    loadPermissions();
  }

  async function removePermission(permissionId: string) {
    if (!labId) return;
    await apiRequest(`/labs/${labId}/permissions/${permissionId}`, { method: "DELETE" });
    loadPermissions();
  }

  async function runNodeAction(nodeId: string, action: "start" | "stop") {
    if (!labId) return;
    const node = nodes.find((item) => item.id === nodeId);
    const nodeName = node?.id || nodeId;
    await apiRequest(`/labs/${labId}/nodes/${encodeURIComponent(nodeName)}/${action}`, {
      method: "POST",
    });
    loadJobs();
    setContextMenu(null);
  }

  function connectConsoleForNode(nodeId: string) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node || !labId) return;
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    const nodeName = node.id;
    if (consoleSocket.current) {
      consoleSocket.current.close();
    }
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl = `${wsProtocol}//${window.location.host}${API_BASE_URL}`;
    if (API_BASE_URL.startsWith("http")) {
      const apiUrl = new URL(API_BASE_URL);
      wsUrl = `${apiUrl.protocol === "https:" ? "wss:" : "ws:"}//${apiUrl.host}`;
    }
    wsUrl = `${wsUrl.replace(/\/$/, "")}/labs/${labId}/nodes/${encodeURIComponent(nodeName)}/console`;
    const socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      setConsoleOutput((prev) => `${prev}${event.data}`);
    };
    socket.onclose = () => {
      setConsoleOutput((prev) => `${prev}\n[console disconnected]\n`);
    };
    consoleSocket.current = socket;
    setContextMenu(null);
  }

  function connectConsole() {
    if (!labId || !selectedNode) return;
    const nodeName = selectedNode.id as string;
    if (consoleSocket.current) {
      consoleSocket.current.close();
    }
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl = `${wsProtocol}//${window.location.host}${API_BASE_URL}`;
    if (API_BASE_URL.startsWith("http")) {
      const apiUrl = new URL(API_BASE_URL);
      wsUrl = `${apiUrl.protocol === "https:" ? "wss:" : "ws:"}//${apiUrl.host}`;
    }
    wsUrl = `${wsUrl.replace(/\/$/, "")}/labs/${labId}/nodes/${encodeURIComponent(nodeName)}/console`;
    const socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      setConsoleOutput((prev) => `${prev}${event.data}`);
    };
    socket.onclose = () => {
      setConsoleOutput((prev) => `${prev}\n[console disconnected]\n`);
    };
    consoleSocket.current = socket;
  }

  function sendConsoleInput() {
    if (!consoleSocket.current || consoleSocket.current.readyState !== WebSocket.OPEN) {
      return;
    }
    consoleSocket.current.send(`${consoleInput}\n`);
    setConsoleInput("");
  }

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, label: "" }, eds)),
    [setEdges]
  );

  function addNode(device: string, label: string) {
    const id = `${device}-${Date.now()}`;
    setNodes((prev) => [
      ...prev,
      {
        id,
        type: "device",
        position: { x: 100 + prev.length * 40, y: 100 + prev.length * 40 },
        data: { label, device, version: "", image: "" },
      },
    ]);
  }

  function onDragOver(event: React.DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    if (!reactFlowWrapper.current || !reactFlowInstance.current) return;
    const payload = event.dataTransfer.getData("application/netlab-device");
    if (!payload) return;
    const { device, label } = JSON.parse(payload) as { device: string; label: string };
    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = reactFlowInstance.current.project({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
    const id = `${device}-${Date.now()}`;
    setNodes((prev) => [
      ...prev,
      { id, type: "device", position, data: { label, device, version: "", image: "" } },
    ]);
  }

  function updateSelectedNode(field: keyof NodeData, value: string) {
    if (!selectedNodeId) return;
    setNodes((prev) =>
      prev.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, [field]: value } }
          : node
      )
    );
  }

  function getImageOptions(deviceId: string | undefined): { label: string; value: string }[] {
    if (!deviceId) return [];
    const entry = imageCatalog[deviceId];
    if (!entry) return [];
    const options = [];
    if (entry.clab) options.push({ label: `clab: ${entry.clab}`, value: entry.clab });
    if (entry.libvirt) options.push({ label: `libvirt: ${entry.libvirt}`, value: entry.libvirt });
    if (entry.virtualbox) options.push({ label: `virtualbox: ${entry.virtualbox}`, value: entry.virtualbox });
    return options;
  }

  function updateSelectedEdge(field: keyof LinkData, value: string) {
    if (!selectedEdgeId) return;
    setEdges((prev) =>
      prev.map((edge) =>
        edge.id === selectedEdgeId
          ? {
              ...edge,
              label: field === "name" ? value : edge.label,
              data: { ...edge.data, [field]: value },
            }
          : edge
      )
    );
  }

  useEffect(() => {
    loadLab();
  }, [labId]);

  useEffect(() => {
    if (!labId) return;
    const timer = window.setInterval(() => {
      loadJobs();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [labId]);

  function handleNodeContextMenu(event: React.MouseEvent, nodeId: string) {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId });
  }

  function deleteNode(nodeId: string) {
    setNodes((prev) => prev.filter((node) => node.id !== nodeId));
    setEdges((prev) => prev.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setContextMenu(null);
  }

  if (!localStorage.getItem("token")) {
    return <div className="panel">Please sign in to view this lab.</div>;
  }

  if (!lab) {
    return <div className="panel">Loading lab...</div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="eyebrow">Lab</div>
        <h1>{lab.name}</h1>
        <p>Created {new Date(lab.created_at).toLocaleString()}</p>
        <div className="badge-row">
          <span className="badge">Topology canvas</span>
          <span className="badge">YAML sync</span>
          <span className="badge">containerlab runtime</span>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Topology actions</h3>
            <p className="panel-subtitle">Keep YAML and canvas in lockstep.</p>
          </div>
          <div className="page-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => runAction("up")}
              aria-label="Start all nodes"
              title="Start all nodes"
            >
              ▶️
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => runAction("down")}
              aria-label="Stop all nodes"
              title="Stop all nodes"
            >
              ⏹️
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setIsShareOpen(true)}
              aria-label="Share lab"
              title="Share lab"
            >
              🤝
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={exportYaml}
              aria-label="Export YAML"
              title="Export YAML"
            >
              ⬇️
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={saveGraph}
              aria-label="Save canvas"
              title="Save canvas"
            >
              💾
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={loadGraph}
              aria-label="Reload canvas"
              title="Reload canvas"
            >
              🔄
            </button>
          </div>
        </div>
        {status && <p className="status">{status}</p>}
      </section>

      <div className="lab-workspace">
        <aside className="panel">
          <div className="panel-header">
            <h3>Device palette</h3>
          </div>
          <p className="panel-subtitle">Drag in common models to build the topology.</p>
          <div className="palette">
            {deviceCatalog.length > 0
              ? deviceCatalog.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addNode(item.id, item.label)}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "application/netlab-device",
                        JSON.stringify({ device: item.id, label: item.label })
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    {renderDeviceIcon(item.id)}
                    <span>{item.label}</span>
                  </button>
                ))
              : fallbackPalette.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addNode(item.id, item.label)}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "application/netlab-device",
                        JSON.stringify({ device: item.id, label: item.label })
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    {renderDeviceIcon(item.id)}
                    <span>{item.label}</span>
                  </button>
                ))}
          </div>
        </aside>

        <section className="panel canvas-panel" ref={reactFlowWrapper} onDrop={onDrop} onDragOver={onDragOver}>
          <div className="canvas-inner">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              onInit={(instance) => {
                reactFlowInstance.current = instance;
              }}
              onNodeClick={(_, node) => {
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
              }}
              onNodeContextMenu={(event, node) => handleNodeContextMenu(event, node.id)}
              onEdgeClick={(_, edge) => {
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
              }}
              fitView
            >
              <MiniMap />
              <Controls />
              <Background />
            </ReactFlow>
            {contextMenu && (
            <div
              className="context-menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={() => setContextMenu(null)}
            >
              <button type="button" onClick={() => runNodeAction(contextMenu.nodeId, "start")}>
                <span className="menu-icon">▶️</span>
                Start device
              </button>
              <button type="button" onClick={() => runNodeAction(contextMenu.nodeId, "stop")}>
                <span className="menu-icon">⏹️</span>
                Stop device
              </button>
              <button type="button" onClick={() => connectConsoleForNode(contextMenu.nodeId)}>
                <span className="menu-icon">🖥️</span>
                Open console
              </button>
              <button type="button" onClick={() => deleteNode(contextMenu.nodeId)}>
                <span className="menu-icon">🗑️</span>
                Delete device
              </button>
            </div>
          )}
          </div>
        </section>

        <aside className="panel">
          <div className="panel-header">
            <h3>Inspector</h3>
          </div>
          <p className="panel-subtitle">Select a node or link to edit properties.</p>
          {selectedNode ? (
            <div className="form">
              <label>
                Label
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => updateSelectedNode("label", e.target.value)}
                />
              </label>
              <label>
                Device
                <select
                  value={selectedNode.data.device || ""}
                  onChange={(e) => updateSelectedNode("device", e.target.value)}
                >
                  <option value="">Select device</option>
                  {deviceCatalog.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Version
                <input
                  value={selectedNode.data.version || ""}
                  onChange={(e) => updateSelectedNode("version", e.target.value)}
                />
              </label>
              <label>
                Image
                {getImageOptions(selectedNode.data.device).length > 0 ? (
                  <select
                    value={selectedNode.data.image || ""}
                    onChange={(e) => updateSelectedNode("image", e.target.value)}
                  >
                    <option value="">Select image</option>
                    {getImageOptions(selectedNode.data.device).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={selectedNode.data.image || ""}
                    onChange={(e) => updateSelectedNode("image", e.target.value)}
                  />
                )}
              </label>
            </div>
          ) : selectedEdge ? (
            <div className="form">
              <label>
                Link name
                <input
                  value={selectedEdge.data?.name || ""}
                  onChange={(e) => updateSelectedEdge("name", e.target.value)}
                />
              </label>
              <label>
                Type
                <input
                  value={selectedEdge.data?.type || ""}
                  onChange={(e) => updateSelectedEdge("type", e.target.value)}
                />
              </label>
              <label>
                Pool
                <input
                  value={selectedEdge.data?.pool || ""}
                  onChange={(e) => updateSelectedEdge("pool", e.target.value)}
                />
              </label>
              <label>
                Prefix
                <input
                  value={selectedEdge.data?.prefix || ""}
                  onChange={(e) => updateSelectedEdge("prefix", e.target.value)}
                />
              </label>
            </div>
          ) : null}
        </aside>
      </div>

      <div className="lab-sections">
        <section className="panel">
          <div className="panel-header">
            <h3>Topology YAML</h3>
          </div>
          <textarea value={yaml} onChange={(e) => setYaml(e.target.value)} rows={16} />
        </section>
        <section className="panel">
          <div className="panel-header">
            <h3>Runtime control</h3>
          </div>
          <div className="inline-form">
            <button onClick={() => runAction("up")}>Up</button>
            <button className="button-secondary" onClick={() => runAction("down")}>
              Down
            </button>
            <button className="button-secondary" onClick={() => runAction("restart")}>
              Restart
            </button>
            <button className="button-secondary" onClick={fetchStatus}>
              Status
            </button>
            <button className="button-secondary" onClick={loadLatestLog}>
              Tail log
            </button>
          </div>
          <textarea value={runtimeLog} readOnly rows={8} />
          <div className="list">
            {jobs.map((job) => (
              <div key={job.id} className="lab-item">
                <span>{job.action}</span>
                <span className="lab-meta">{job.status}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="lab-sections">
        <section className="panel">
          <div className="panel-header">
            <h3>Console</h3>
          </div>
          <p className="panel-subtitle">
            Selected node: {selectedNode ? selectedNode.data.label : "None"}
          </p>
          <div className="inline-form">
            <button onClick={connectConsole} disabled={!selectedNode}>
              Connect
            </button>
            <button className="button-secondary" onClick={loadNodeActionLog} disabled={!selectedNode}>
              Load node action log
            </button>
          </div>
          <textarea value={consoleOutput} readOnly rows={8} />
          <textarea value={deviceLog} readOnly rows={6} placeholder="Node action log" />
          <div className="inline-form">
            <input
              value={consoleInput}
              onChange={(e) => setConsoleInput(e.target.value)}
              placeholder="Command"
            />
            <button onClick={sendConsoleInput}>Send</button>
          </div>
        </section>
      </div>
      {isShareOpen && (
        <div className="modal-backdrop" onClick={() => setIsShareOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h3>Share this lab</h3>
              <button
                className="icon-button"
                type="button"
                onClick={() => setIsShareOpen(false)}
                aria-label="Close share panel"
              >
                ✕
              </button>
            </div>
            <p className="panel-subtitle">Grant view or edit access to another user.</p>
            <div className="inline-form">
              <input
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                placeholder="User email"
              />
              <select value={shareRole} onChange={(e) => setShareRole(e.target.value)}>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button onClick={shareLab}>Share</button>
            </div>
            <div className="list">
              {permissions.map((perm) => (
                <div key={perm.id} className="lab-item">
                  <span>{perm.user_email || perm.user_id}</span>
                  <div className="page-actions">
                    <span className="lab-meta">{perm.role}</span>
                    <button className="button-secondary" onClick={() => removePermission(perm.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
