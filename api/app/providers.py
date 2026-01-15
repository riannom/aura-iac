from __future__ import annotations

from typing import Callable

from app.storage import topology_path


class ProviderActionError(ValueError):
    pass


def _unsupported_node_command(lab_id: str, action: str, node: str) -> list[str]:
    raise ProviderActionError("Node actions are not implemented for this provider")


def _clab_node_command(lab_id: str, action: str, node: str) -> list[str]:
    if action == "start":
        command = ["clab", "deploy", "--node-filter", node, "-t", str(topology_path(lab_id))]
        return command
    if action == "stop":
        command = ["clab", "destroy", "--node-filter", node, "-t", str(topology_path(lab_id))]
        return command
    raise ProviderActionError("Node action is not supported by provider")


_NODE_ACTIONS: dict[str, Callable[[str, str, str], list[str]]] = {
    "clab": _clab_node_command,
    "libvirt": _unsupported_node_command,
}

# To add a provider:
# - Implement a <provider>_node_command(lab_id, action, node) builder.
# - Register it in _NODE_ACTIONS with the provider key (matching NETLAB_PROVIDER).
# - Update supports_node_actions if the provider supports per-node actions.


def supports_node_actions(provider: str) -> bool:
    return provider in _NODE_ACTIONS and provider != "libvirt"


def supported_node_actions(provider: str) -> set[str]:
    if provider == "clab":
        return {"start", "stop"}
    return set()


def node_action_command(provider: str, lab_id: str, action: str, node: str) -> list[str]:
    builder = _NODE_ACTIONS.get(provider)
    if not builder:
        raise ProviderActionError("Node actions are not supported for this provider")
    return builder(lab_id, action, node)
