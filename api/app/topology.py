from __future__ import annotations

from typing import Any
import hashlib
import re

import yaml

from app.schemas import GraphEndpoint, GraphLink, GraphNode, TopologyGraph

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
            if isinstance(value, dict):
                endpoints.append(GraphEndpoint(node=key, ifname=value.get("ifname")))
            else:
                endpoints.append(GraphEndpoint(node=key))
        return GraphLink(endpoints=endpoints, **attrs)
    return None


def yaml_to_graph(content: str) -> TopologyGraph:
    data = yaml.safe_load(content) or {}

    defaults = data.get("defaults", {})
    nodes_data = data.get("nodes", {})
    links_data = data.get("links", [])

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
                    vars={k: v for k, v in attrs.items() if k not in {"device", "image", "version", "role", "mgmt"}},
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
