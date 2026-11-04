import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location("release_builder", Path(__file__).parents[1] / "scripts/build-release.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class ReleaseTests(unittest.TestCase):
    def fixture(self, root):
        for name in builder.REQUIRED:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if name in {"plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"}:
                content = json.dumps({"version": "2.0.0"})
            elif name == ".claude-plugin/marketplace.json":
                content = json.dumps({"plugins": [{"version": "2.0.0"}]})
            elif name.endswith("/VERSION"):
                content = "2.0.0\n"
            else:
                content = "Fixture\n"
            target.write_text(content, encoding="utf-8", newline="\n")
        (root / ".env").write_text("PRIVATE_FIXTURE=must-not-ship", encoding="utf-8")
        (root / "internal-test.log").write_text("must-not-ship", encoding="utf-8")
        for args in (["init", "-q"], ["config", "user.name", "Fixture"], ["config", "user.email", "fixture@example.invalid"], ["add", "."], ["commit", "-qm", "fixture"]):
            builder.git(root, *args)

    def test_reproducible_and_allowlisted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            self.fixture(root)
            first = builder.build(root, Path(directory) / "one", "v2.0.0")
            second = builder.build(root, Path(directory) / "two", "v2.0.0")
            self.assertEqual(first, second)
            data = (Path(directory) / "one" / first["archive"]).read_bytes()
            self.assertEqual(data, (Path(directory) / "two" / first["archive"]).read_bytes())
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                self.assertEqual(set(archive.namelist()), builder.REQUIRED)
                for name, digest in first["files"].items():
                    self.assertEqual(builder.hashlib.sha256(archive.read(name)).hexdigest(), digest)

    def test_refuses_dirty_or_uncommitted_product(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            self.fixture(root)
            (root / "plugin.json").write_text('{"version":"3.0.0"}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "differs from committed"):
                builder.build(root, Path(directory) / "out")
            builder.git(root, "checkout", "--", "plugin.json")
            (root / "skills/futuria-crm/forgotten.md").write_text("Uncommitted", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Uncommitted product"):
                builder.build(root, Path(directory) / "out")

    def test_rejects_tag_mismatch_and_unsafe_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            self.fixture(root)
            with self.assertRaisesRegex(ValueError, "does not match"):
                builder.build(root, Path(directory) / "out", "v1.3.3")
        for path in ("../escape.md", "/absolute.md", "skills/futuria-crm/.env", "skills/futuria-crm/credential.xml"):
            with self.assertRaises(ValueError, msg=path):
                builder.selected_path(path)


if __name__ == "__main__":
    unittest.main()
