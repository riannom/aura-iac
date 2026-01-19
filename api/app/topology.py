from __future__ import annotations

from typing import Any
import hashlib
import re

import yaml

from app.schemas import (
    CrossHostLink,
    GraphEndpoint,
    GraphLink,
    GraphNode,
    NodePlacement,
    TopologyAnalysis,
    TopologyGraph,
)

LINK_ATTRS = {
    "bandwidth",
    "bridge",
    "disable",
    "gateway",
    "group",
    "mtu",
    "name",
    "pool",
    "prefix",
    "ra",
    "role",
    "shutdown",
    "type",
}

_NODE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,15}$")


def _safe_node_name(name: str, used: set[str]) -> str:
    if _NODE_NAME_RE.match(name) and name not in used:
        return name
    clean = re.sub(r"[^A-Za-z0-9_]", "_", name).strip("_")
    if not clean or not re.match(r"^[A-Za-z_]", clean):
        clean = f"n_{clean}" if clean else "n"
    for attempt in range(100):
        suffix = hashlib.md5(f"{name}-{attempt}".encode()).hexdigest()[:4]
        base_max = 16 - len(suffix) - 1
        base = clean[: max(base_max, 1)]
        candidate = f"{base}_{suffix}"
        if candidate not in used:
            return candidate
    return f"n_{hashlib.md5(name.encode()).hexdigest()[:13]}"


def _format_external_endpoint(endpoint: GraphEndpoint) -> str:
    """Format an external endpoint for containerlab YAML.

    External endpoints use format: type:name (e.g., bridge:br-ext, macvlan:eth0)
    """
    if endpoint.type == "node":
        return endpoint.node
    return f"{endpoint.type}:{endpoint.node}"


def graph_to_yaml(graph: TopologyGraph) -> str:
    nodes: dict[str, Any] = {}
    name_map: dict[str, str] = {}
    used_names: set[str] = set()
    for node in graph.nodes:
        safe_name = _safe_node_name(node.name, used_names)
        name_map[node.name] = safe_name
        used_names.add(safe_name)
        node_data: dict[str, Any] = {}
        if node.device:
            node_data["device"] = node.device
        if node.image:
            node_data["image"] = node.image
        if node.version:
            node_data["version"] = node.version
        if node.role:
            node_data["role"] = node.role
        if node.mgmt:
            node_data["mgmt"] = node.mgmt
        if node.network_mode:
            node_data["network-mode"] = node.network_mode
        if node.vars:
            vars_copy = dict(node.vars)
            if "label" in vars_copy and "name" not in vars_copy:
                vars_copy["name"] = vars_copy.pop("label")
            node_data.update(vars_copy)
        nodes[safe_name] = node_data or None

    links = []
    for link in graph.links:
        link_data: dict[str, Any] = {}
        if link.type:
            link_data["type"] = link.type
        if link.name:
            link_data["name"] = link.name
        if link.pool:
            link_data["pool"] = link.pool
        if link.prefix:
            link_data["prefix"] = link.prefix
        if link.bridge:
            link_data["bridge"] = link.bridge
        if link.mtu is not None:
            link_data["mtu"] = link.mtu
        if link.bandwidth is not None:
            link_data["bandwidth"] = link.bandwidth

        for endpoint in link.endpoints:
            # Handle external endpoints (bridge, macvlan, host)
            if endpoint.type != "node":
                endpoint_key = _format_external_endpoint(endpoint)
                if endpoint.ifname:
                    link_data[endpoint_key] = {"ifname": endpoint.ifname}
                else:
                    link_data[endpoint_key] = {}
            else:
                endpoint_name = name_map.get(endpoint.node, endpoint.node)
                if endpoint.ifname:
                    link_data[endpoint_name] = {"ifname": endpoint.ifname}
                else:
                    link_data[endpoint_name] = {}

        links.append(link_data)

    topology: dict[str, Any] = {}
    if graph.defaults:
        topology["defaults"] = graph.defaults
    topology["nodes"] = nodes
    topology["links"] = links

    return yaml.safe_dump(topology, sort_keys=False)


EXTERNAL_ENDPOINT_TYPES = {"bridge", "macvlan", "host"}


def _parse_endpoint_key(key: str) -> tuple[str, str]:
    """Parse an endpoint key that may be an external endpoint.

    External endpoints use format: type:name (e.g., bridge:br-ext, macvlan:eth0)
    Returns (node_or_name, endpoint_type) where endpoint_type is "node" for regular nodes.
    """
    if ":" in key:
        parts = key.split(":", 1)
        if parts[0] in EXTERNAL_ENDPOINT_TYPES:
            return parts[1], parts[0]
    return key, "node"


def _parse_link_item(item: Any) -> GraphLink | None:
    if isinstance(item, str) and "-" in item:
        parts = item.split("-")
        if len(parts) == 2:
            return GraphLink(endpoints=[GraphEndpoint(node=parts[0]), GraphEndpoint(node=parts[1])])
        return None
    if isinstance(item, list):
        endpoints = [GraphEndpoint(node=str(node)) for node in item]
        return GraphLink(endpoints=endpoints)
    if isinstance(item, dict):
        endpoints: list[GraphEndpoint] = []
        attrs: dict[str, Any] = {}
        for key, value in item.items():
            if key in LINK_ATTRS:
                attrs[key] = value
                continue
            # Parse endpoint key for external connections
            node_name, ep_type = _parse_endpoint_key(key)
            if isinstance(value, dict):
                endpoints.append(GraphEndpoint(
                    node=node_name,
                    ifname=value.get("ifname"),
                    type=ep_type,
                ))
            else:
                endpoints.append(GraphEndpoint(node=node_name, type=ep_type))
        return GraphLink(endpoints=endpoints, **attrs)
    return None


def yaml_to_graph(content: str) -> TopologyGraph:
    data = yaml.safe_load(content) or {}

    defaults = data.get("defaults", {})
    nodes_data = data.get("nodes", {})
    links_data = data.get("links", [])

    # Fields that are parsed as explicit GraphNode attributes (not stored in vars)
    node_explicit_fields = {"device", "image", "version", "role", "mgmt", "network-mode", "host"}

    nodes: list[GraphNode] = []
    if isinstance(nodes_data, list):
        for name in nodes_data:
            nodes.append(GraphNode(id=str(name), name=str(name)))
    elif isinstance(nodes_data, dict):
        for name, attrs in nodes_data.items():
            attrs = attrs or {}
            nodes.append(
                GraphNode(
                    id=str(name),
                    name=str(name),
                    device=attrs.get("device"),
                    image=attrs.get("image"),
                    version=attrs.get("version"),
                    role=attrs.get("role"),
                    mgmt=attrs.get("mgmt"),
                    network_mode=attrs.get("network-mode"),
                    host=attrs.get("host"),
                    vars={k: v for k, v in attrs.items() if k not in node_explicit_fields},
                )
            )

    links: list[GraphLink] = []
    if isinstance(links_data, dict):
        for group_links in links_data.values():
            if isinstance(group_links, list):
                for item in group_links:
                    parsed = _parse_link_item(item)
                    if parsed:
                        links.append(parsed)
    elif isinstance(links_data, list):
        for item in links_data:
            parsed = _parse_link_item(item)
            if parsed:
                links.append(parsed)

    return TopologyGraph(nodes=nodes, links=links, defaults=defaults)


def analyze_topology(graph: TopologyGraph, default_host: str | None = None) -> TopologyAnalysis:
    """Analyze a topology for multi-host deployment.

    Detects which nodes should run on which hosts and identifies
    links that span multiple hosts (requiring overlay networking).

    Args:
        graph: The topology graph to analyze
        default_host: Default host for nodes without explicit placement

    Returns:
        TopologyAnalysis with placements and cross-host links
    """
    # Build node -> host mapping
    node_hosts: dict[str, str] = {}
    for node in graph.nodes:
        host = node.host or default_host
        if host:
            node_hosts[node.name] = host

    # If no placements specified, all on default host
    if not node_hosts and default_host:
        for node in graph.nodes:
            node_hosts[node.name] = default_host

    # Group nodes by host
    placements: dict[str, list[NodePlacement]] = {}
    for node in graph.nodes:
        host = node_hosts.get(node.name)
        if host:
            if host not in placements:
                placements[host] = []
            placements[host].append(NodePlacement(node_name=node.name, host_id=host))

    # Detect cross-host links
    cross_host_links: list[CrossHostLink] = []
    link_counter = 0

    for link in graph.links:
        if len(link.endpoints) != 2:
            continue  # Skip non-point-to-point links

        ep_a, ep_b = link.endpoints
        host_a = node_hosts.get(ep_a.node)
        host_b = node_hosts.get(ep_b.node)

        # If both endpoints have hosts and they differ, it's a cross-host link
        if host_a and host_b and host_a != host_b:
            link_id = f"{ep_a.node}:{ep_a.ifname or 'eth0'}-{ep_b.node}:{ep_b.ifname or 'eth0'}"
            cross_host_links.append(
                CrossHostLink(
                    link_id=link_id,
                    node_a=ep_a.node,
                    interface_a=ep_a.ifname or f"eth{link_counter}",
                    host_a=host_a,
                    node_b=ep_b.node,
                    interface_b=ep_b.ifname or f"eth{link_counter}",
                    host_b=host_b,
                )
            )
            link_counter += 1

    # Determine if single-host or multi-host
    unique_hosts = set(node_hosts.values())
    single_host = len(unique_hosts) <= 1

    return TopologyAnalysis(
        placements=placements,
        cross_host_links=cross_host_links,
        single_host=single_host,
    )


def split_topology_by_host(
    graph: TopologyGraph,
    analysis: TopologyAnalysis,
) -> dict[str, TopologyGraph]:
    """Split a topology into per-host sub-topologies.

    For multi-host deployments, each host only needs the nodes
    that run on it. Cross-host links are excluded (handled by overlay).

    Args:
        graph: The original topology graph
        analysis: Topology analysis with placements

    Returns:
        Dict mapping host_id to sub-topology for that host
    """
    # Build node name -> host mapping
    node_to_host: dict[str, str] = {}
    for host_id, placements in analysis.placements.items():
        for p in placements:
            node_to_host[p.node_name] = host_id

    # Build set of cross-host link endpoints for exclusion
    cross_host_endpoints: set[tuple[str, str]] = set()
    for chl in analysis.cross_host_links:
        cross_host_endpoints.add((chl.node_a, chl.interface_a))
        cross_host_endpoints.add((chl.node_b, chl.interface_b))

    # Create sub-topology for each host
    result: dict[str, TopologyGraph] = {}

    for host_id in analysis.placements:
        # Nodes for this host
        host_node_names = {p.node_name for p in analysis.placements[host_id]}
        host_nodes = [n for n in graph.nodes if n.name in host_node_names]

        # Links where both endpoints are on this host
        host_links: list[GraphLink] = []
        for link in graph.links:
            if len(link.endpoints) != 2:
                # Include non-point-to-point links if all nodes on this host
                all_on_host = all(ep.node in host_node_names for ep in link.endpoints)
                if all_on_host:
                    host_links.append(link)
                continue

            ep_a, ep_b = link.endpoints

            # Skip if either node not on this host
            if ep_a.node not in host_node_names or ep_b.node not in host_node_names:
                continue

            # Skip cross-host links (they're handled by overlay)
            if (ep_a.node, ep_a.ifname or "eth0") in cross_host_endpoints:
                continue
            if (ep_b.node, ep_b.ifname or "eth0") in cross_host_endpoints:
                continue

            host_links.append(link)

        result[host_id] = TopologyGraph(
            nodes=host_nodes,
            links=host_links,
            defaults=graph.defaults,
        )

    return result
