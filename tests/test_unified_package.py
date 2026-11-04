"""Distribution contract tests: no network, client config or customer credentials.

OAuth is discovered from the protected customer server. Native Codex 0.160.1
and the upstream Agent Plugins 1.0 MCP schema reject server extensions;
the distributable manifest therefore contains only the standard transport/URL.
See AGENTS.md for the runtime/documentation discrepancy.
"""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("plugin_validator", ROOT / "scripts/validate-plugin.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class UnifiedPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="futuria-package-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ["plugin.json", "mcp.json", ".mcp.json", ".codex-plugin/plugin.json",
                     ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json",
                     ".agents/plugins/marketplace.json", "skills/futuria-crm/SKILL.md",
                     "skills/futuria-crm/VERSION"]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)

    def edit(self, name, mutate):
        path = self.root / name
        data = json.loads(path.read_text(encoding="utf-8"))
        mutate(data)
        path.write_text(json.dumps(data), encoding="utf-8")

    def test_current_product_contract_passes(self):
        self.assertEqual([], validator.unified_package_errors(self.root))

    def test_all_versioned_surfaces_must_match(self):
        for name in ["plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]:
            with self.subTest(name=name):
                original = (self.root / name).read_bytes()
                self.edit(name, lambda data: data.update(version="0.0.1"))
                self.assertTrue(validator.unified_package_errors(self.root))
                (self.root / name).write_bytes(original)
        (self.root / "skills/futuria-crm/VERSION").write_text("0.0.1\n", encoding="utf-8")
        self.assertTrue(validator.unified_package_errors(self.root))

    def test_customer_endpoint_cannot_be_replaced_by_other_connection(self):
        for name in ["mcp.json", ".mcp.json"]:
            with self.subTest(name=name):
                original = (self.root / name).read_bytes()
                self.edit(name, lambda data: data["mcpServers"]["futuria-crm"].update(url="https://example.invalid/mcp"))
                self.assertTrue(validator.unified_package_errors(self.root))
                (self.root / name).write_bytes(original)

    def test_rejects_auth_extension_unsupported_by_native_runtime(self):
        self.edit("mcp.json", lambda data: data["mcpServers"]["futuria-crm"].update(extensions={"com.openai": {"auth": {"type": "oauth"}}}))
        self.assertTrue(validator.unified_package_errors(self.root))

    def test_credentials_cannot_be_bundled_in_connection(self):
        for name in ["mcp.json", ".mcp.json"]:
            with self.subTest(name=name):
                original = (self.root / name).read_bytes()
                self.edit(name, lambda data: data["mcpServers"]["futuria-crm"].update(headers={"Authorization": "forbidden-in-package"}))
                self.assertTrue(validator.unified_package_errors(self.root))
                (self.root / name).write_bytes(original)

    def test_portable_and_compatibility_transports_are_not_interchangeable(self):
        self.edit("mcp.json", lambda data: data["mcpServers"]["futuria-crm"].update(type="http"))
        self.assertTrue(validator.unified_package_errors(self.root))

    def test_plugin_cannot_wire_an_independent_skill_copy(self):
        self.edit(".codex-plugin/plugin.json", lambda data: data.update(skills="./skills-codex/"))
        self.assertTrue(validator.unified_package_errors(self.root))

    def test_single_marketplace_entry_resolves_same_product(self):
        self.edit(".agents/plugins/marketplace.json", lambda data: data["plugins"][0].update(source={"source": "local", "path": "./other"}))
        self.assertTrue(validator.unified_package_errors(self.root))

    def test_rejects_custom_lifecycle_updater_and_fake_app_mapping(self):
        self.edit(".codex-plugin/plugin.json", lambda data: data.update(hooks="./hooks/hooks.json"))
        self.assertTrue(validator.unified_package_errors(self.root))
        (self.root / ".app.json").write_text('{"apps":{}}', encoding="utf-8")
        self.assertTrue(validator.unified_package_errors(self.root))

    def test_missing_or_malformed_root_component_is_a_validation_error(self):
        (self.root / "mcp.json").write_text("{", encoding="utf-8")
        self.assertTrue(validator.unified_package_errors(self.root))
        (self.root / "plugin.json").unlink()
        self.assertTrue(validator.unified_package_errors(self.root))


if __name__ == "__main__":
    unittest.main()
