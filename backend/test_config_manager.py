import json
import unittest
from unittest.mock import patch

from backend import config_manager
from backend import github_client


class ConfigManagerTests(unittest.TestCase):
    def test_parts_schedule_only_updates_control_config(self):
        previous = {
            "timezone": "Asia/Shanghai",
            "tasks": {
                "split": {"enabled": False, "schedule_mode": "daily", "minute": 0, "times": []},
                "parts": {
                    "enabled": True,
                    "schedule_mode": "daily",
                    "minute": 0,
                    "times": ["17:00", "12:00"],
                    "schedule_updated_at": "2026-09-16T08:35:00Z",
                },
            },
        }
        requested = {
            "timezone": "Asia/Shanghai",
            "tasks": {
                "split": {"enabled": False, "schedule_mode": "daily", "minute": 0, "times": []},
                "parts": {
                    "enabled": True,
                    "schedule_mode": "daily",
                    "times": ["18:00", "12:30"],
                },
            },
        }
        writes = []

        def fake_get_file(repo, path):
            if repo == config_manager.CONTROL_REPO and path == config_manager.CONFIG_PATH:
                return json.dumps(previous, ensure_ascii=False, indent=2) + "\n", "config-sha"
            if (repo, path) == config_manager.SPLIT_TARGET:
                return "name: split\non:\n  workflow_dispatch:\n", "split-sha"
            self.fail(f"unexpected file read: {repo}/{path}")

        def fake_put_file(repo, path, content, sha, message):
            writes.append((repo, path, content, sha, message))
            return "commit-sha"

        with patch.object(config_manager, "get_config", return_value=previous), \
             patch.object(config_manager, "_get_file", side_effect=fake_get_file), \
             patch.object(config_manager, "_put_file", side_effect=fake_put_file):
            normalized, results = config_manager.save_config(requested)

        self.assertEqual(results["parts"], "control-panel-scheduler")
        self.assertEqual(normalized["tasks"]["parts"]["times"], ["18:00", "12:30"])
        self.assertTrue(normalized["tasks"]["parts"]["schedule_updated_at"])
        self.assertTrue(any(repo == config_manager.CONTROL_REPO and path == config_manager.CONFIG_PATH for repo, path, *_ in writes))
        self.assertFalse(any("weijiagong-lingjian-guidang" in repo for repo, *_ in writes))

    def test_parts_immediate_run_uses_workflow_dispatch_inputs(self):
        with patch.object(github_client, "dispatch_workflow", return_value={"status": "requested"}) as dispatch:
            result = github_client.run_parts()

        self.assertEqual(result["status"], "requested")
        dispatch.assert_called_once_with(
            "zx18522296069-commits/weijiagong-lingjian-guidang",
            "update_parts.yml",
            {
                "mode": "production",
                "trigger_source": "control-panel-manual",
                "scheduled_for": "",
            },
        )


if __name__ == "__main__":
    unittest.main()
