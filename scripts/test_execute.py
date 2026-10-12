"""
execute.py 리팩터링 안전망 테스트.
리팩터링 전후 동작이 동일한지 검증한다.
"""

import json
import os
import subprocess
import sys
import textwrap
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import execute as ex


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_project(tmp_path):
    """phases/, AGENTS.md, docs/ 를 갖춘 임시 프로젝트 구조."""
    phases_dir = tmp_path / "phases"
    phases_dir.mkdir()

    agents_md = tmp_path / "AGENTS.md"
    agents_md.write_text("# Rules\n- rule one\n- rule two")

    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "arch.md").write_text("# Architecture\nSome content")
    (docs_dir / "guide.md").write_text("# Guide\nAnother doc")

    return tmp_path


@pytest.fixture
def phase_dir(tmp_project):
    """step 3개를 가진 phase 디렉토리."""
    d = tmp_project / "phases" / "0-mvp"
    d.mkdir()

    index = {
        "project": "TestProject",
        "phase": "mvp",
        "steps": [
            {"step": 0, "name": "setup", "status": "completed", "summary": "프로젝트 초기화 완료"},
            {"step": 1, "name": "core", "status": "completed", "summary": "핵심 로직 구현"},
            {"step": 2, "name": "ui", "status": "pending"},
        ],
    }
    (d / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False))
    (d / "step2.md").write_text("# Step 2: UI\n\nUI를 구현하세요.")

    return d


@pytest.fixture
def top_index(tmp_project):
    """phases/index.json (top-level)."""
    top = {
        "phases": [
            {"dir": "0-mvp", "status": "pending"},
            {"dir": "1-polish", "status": "pending"},
        ]
    }
    p = tmp_project / "phases" / "index.json"
    p.write_text(json.dumps(top, indent=2))
    return p


@pytest.fixture
def executor(tmp_project, phase_dir):
    """테스트용 StepExecutor 인스턴스. git 호출은 별도 mock 필요."""
    with patch.object(ex, "ROOT", tmp_project):
        inst = ex.StepExecutor("0-mvp")
    # 내부 경로를 tmp_project 기준으로 재설정
    inst._root = str(tmp_project)
    inst._phases_dir = tmp_project / "phases"
    inst._phase_dir = phase_dir
    inst._phase_dir_name = "0-mvp"
    inst._index_file = phase_dir / "index.json"
    inst._top_index_file = tmp_project / "phases" / "index.json"
    return inst


# ---------------------------------------------------------------------------
# _stamp (= 이전 now_iso)
# ---------------------------------------------------------------------------

class TestStamp:
    def test_returns_kst_timestamp(self, executor):
        result = executor._stamp()
        assert "+0900" in result

    def test_format_is_iso(self, executor):
        result = executor._stamp()
        dt = datetime.strptime(result, "%Y-%m-%dT%H:%M:%S%z")
        assert dt.tzinfo is not None

    def test_is_current_time(self, executor):
        before = datetime.now(ex.StepExecutor.TZ).replace(microsecond=0)
        result = executor._stamp()
        after = datetime.now(ex.StepExecutor.TZ).replace(microsecond=0) + timedelta(seconds=1)
        parsed = datetime.strptime(result, "%Y-%m-%dT%H:%M:%S%z")
        assert before <= parsed <= after


# ---------------------------------------------------------------------------
# _read_json / _write_json
# ---------------------------------------------------------------------------

class TestJsonHelpers:
    def test_roundtrip(self, tmp_path):
        data = {"key": "값", "nested": [1, 2, 3]}
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, data)
        loaded = ex.StepExecutor._read_json(p)
        assert loaded == data

    def test_save_ensures_ascii_false(self, tmp_path):
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, {"한글": "테스트"})
        raw = p.read_text()
        assert "한글" in raw
        assert "\\u" not in raw

    def test_save_indented(self, tmp_path):
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, {"a": 1})
        raw = p.read_text()
        assert "\n" in raw

    def test_load_nonexistent_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            ex.StepExecutor._read_json(tmp_path / "nope.json")


# ---------------------------------------------------------------------------
# _load_guardrails
# ---------------------------------------------------------------------------

class TestLoadGuardrails:
    def test_loads_agents_md_and_docs(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "# Rules" in result
        assert "rule one" in result
        assert "# Architecture" in result
        assert "# Guide" in result

    def test_sections_separated_by_divider(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "---" in result

    def test_docs_sorted_alphabetically(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        arch_pos = result.index("arch")
        guide_pos = result.index("guide")
        assert arch_pos < guide_pos

    def test_excludes_docs_subdirectories(self, executor, tmp_project):
        testing_dir = tmp_project / "docs" / "testing"
        testing_dir.mkdir()
        (testing_dir / "browser.md").write_text("# Browser Testing\nscenario")
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "# Architecture" in result
        assert "Browser Testing" not in result

    def test_no_agents_md(self, executor, tmp_project):
        (tmp_project / "AGENTS.md").unlink()
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "AGENTS.md" not in result
        assert "Architecture" in result

    def test_no_docs_dir(self, executor, tmp_project):
        import shutil
        shutil.rmtree(tmp_project / "docs")
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "Rules" in result
        assert "Architecture" not in result

    def test_empty_project(self, tmp_path):
        with patch.object(ex, "ROOT", tmp_path):
            # executor가 필요 없는 static-like 동작이므로 임시 인스턴스
            phases_dir = tmp_path / "phases" / "dummy"
            phases_dir.mkdir(parents=True)
            idx = {"project": "T", "phase": "t", "steps": []}
            (phases_dir / "index.json").write_text(json.dumps(idx))
            inst = ex.StepExecutor.__new__(ex.StepExecutor)
            result = inst._load_guardrails()
        assert result == ""


# ---------------------------------------------------------------------------
# _build_step_context
# ---------------------------------------------------------------------------

class TestBuildStepContext:
    def test_includes_completed_with_summary(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        result = ex.StepExecutor._build_step_context(index)
        assert "Step 0 (setup): 프로젝트 초기화 완료" in result
        assert "Step 1 (core): 핵심 로직 구현" in result

    def test_excludes_pending(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        result = ex.StepExecutor._build_step_context(index)
        assert "ui" not in result

    def test_excludes_completed_without_summary(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        del index["steps"][0]["summary"]
        result = ex.StepExecutor._build_step_context(index)
        assert "setup" not in result
        assert "core" in result

    def test_empty_when_no_completed(self):
        index = {"steps": [{"step": 0, "name": "a", "status": "pending"}]}
        result = ex.StepExecutor._build_step_context(index)
        assert result == ""

    def test_has_header(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        result = ex.StepExecutor._build_step_context(index)
        assert result.startswith("## 이전 Step 산출물")


# ---------------------------------------------------------------------------
# _build_preamble
# ---------------------------------------------------------------------------

class TestBuildPreamble:
    def test_includes_project_name(self, executor):
        result = executor._build_preamble("", "")
        assert "TestProject" in result

    def test_includes_guardrails(self, executor):
        result = executor._build_preamble("GUARD_CONTENT", "")
        assert "GUARD_CONTENT" in result

    def test_includes_step_context(self, executor):
        ctx = "## 이전 Step 산출물\n\n- Step 0: done"
        result = executor._build_preamble("", ctx)
        assert "이전 Step 산출물" in result

    def test_tells_session_not_to_commit(self, executor):
        # 커밋은 실행기가 feat(코드)·chore(index.json)로 나눠 한다.
        result = executor._build_preamble("", "")
        assert "커밋하지 마라" in result
        assert "모든 변경사항을 커밋하라" not in result

    def test_includes_rules(self, executor):
        result = executor._build_preamble("", "")
        assert "작업 규칙" in result
        assert "AC" in result

    def test_no_retry_section_by_default(self, executor):
        result = executor._build_preamble("", "")
        assert "이전 시도 실패" not in result

    def test_retry_section_with_prev_error(self, executor):
        result = executor._build_preamble("", "", prev_error="타입 에러 발생")
        assert "이전 시도 실패" in result
        assert "타입 에러 발생" in result

    def test_includes_max_retries(self, executor):
        result = executor._build_preamble("", "")
        assert str(ex.StepExecutor.MAX_RETRIES) in result

    def test_includes_index_path(self, executor):
        result = executor._build_preamble("", "")
        assert "/phases/0-mvp/index.json" in result


# ---------------------------------------------------------------------------
# _update_top_index
# ---------------------------------------------------------------------------

class TestUpdateTopIndex:
    def test_completed(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("completed")
        data = json.loads(top_index.read_text())
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "completed"
        assert "completed_at" in mvp

    def test_error(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("error")
        data = json.loads(top_index.read_text())
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "error"
        assert "failed_at" in mvp

    def test_blocked(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("blocked")
        data = json.loads(top_index.read_text())
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "blocked"
        assert "blocked_at" in mvp

    def test_other_phases_unchanged(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("completed")
        data = json.loads(top_index.read_text())
        polish = next(p for p in data["phases"] if p["dir"] == "1-polish")
        assert polish["status"] == "pending"

    def test_nonexistent_dir_is_noop(self, executor, top_index):
        executor._top_index_file = top_index
        executor._phase_dir_name = "no-such-dir"
        original = json.loads(top_index.read_text())
        executor._update_top_index("completed")
        after = json.loads(top_index.read_text())
        for p_before, p_after in zip(original["phases"], after["phases"]):
            assert p_before["status"] == p_after["status"]

    def test_no_top_index_file(self, executor, tmp_path):
        executor._top_index_file = tmp_path / "nonexistent.json"
        executor._update_top_index("completed")  # should not raise


# ---------------------------------------------------------------------------
# _checkout_branch (mocked)
# ---------------------------------------------------------------------------

class TestCheckoutBranch:
    def _mock_git(self, executor, responses):
        call_idx = {"i": 0}
        def fake_git(*args):
            idx = call_idx["i"]
            call_idx["i"] += 1
            if idx < len(responses):
                return responses[idx]
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

    def test_already_on_branch(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="feat-mvp\n", stderr=""),
        ])
        executor._checkout_branch()  # should return without checkout

    def test_branch_exists_checkout(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=0, stdout="", stderr=""),
            MagicMock(returncode=0, stdout="", stderr=""),
        ])
        executor._checkout_branch()

    def test_branch_not_exists_create(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=1, stdout="", stderr="not found"),
            MagicMock(returncode=0, stdout="", stderr=""),
        ])
        executor._checkout_branch()

    def test_checkout_fails_exits(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=1, stdout="", stderr=""),
            MagicMock(returncode=1, stdout="", stderr="dirty tree"),
        ])
        with pytest.raises(SystemExit) as exc_info:
            executor._checkout_branch()
        assert exc_info.value.code == 1

    def test_no_git_exits(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=1, stdout="", stderr="not a git repo"),
        ])
        with pytest.raises(SystemExit) as exc_info:
            executor._checkout_branch()
        assert exc_info.value.code == 1


# ---------------------------------------------------------------------------
# _check_node_version
# ---------------------------------------------------------------------------

class TestCheckNodeVersion:
    def _node(self, stdout):
        return MagicMock(returncode=0, stdout=stdout, stderr="")

    def test_matching_major_passes(self, executor, tmp_project):
        (tmp_project / ".nvmrc").write_text("24\n")
        with patch.object(ex, "ROOT", tmp_project), \
             patch.object(ex.subprocess, "run", return_value=self._node("v24.11.0\n")) as mock_run:
            executor._check_node_version()
        assert mock_run.call_args[0][0] == ["node", "-v"]

    def test_mismatched_major_exits(self, executor, tmp_project):
        (tmp_project / ".nvmrc").write_text("24\n")
        with patch.object(ex, "ROOT", tmp_project), \
             patch.object(ex.subprocess, "run", return_value=self._node("v26.10.0\n")):
            with pytest.raises(SystemExit) as exc_info:
                executor._check_node_version()
        assert exc_info.value.code == 1

    def test_missing_node_exits(self, executor, tmp_project):
        (tmp_project / ".nvmrc").write_text("24\n")
        with patch.object(ex, "ROOT", tmp_project), \
             patch.object(ex.subprocess, "run", side_effect=FileNotFoundError):
            with pytest.raises(SystemExit) as exc_info:
                executor._check_node_version()
        assert exc_info.value.code == 1

    def test_no_nvmrc_skips(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project), \
             patch.object(ex.subprocess, "run") as mock_run:
            executor._check_node_version()
        mock_run.assert_not_called()

    def test_run_checks_node_before_branch(self, executor):
        calls = []
        for name in ["_print_header", "_check_node_version", "_check_blockers",
                     "_checkout_branch", "_ensure_created_at", "_execute_all_steps", "_finalize"]:
            setattr(executor, name, lambda *a, n=name: calls.append(n))
        executor._load_guardrails = lambda: ""
        executor.run()
        assert calls.index("_check_node_version") < calls.index("_checkout_branch")


# ---------------------------------------------------------------------------
# _commit_step (mocked)
# ---------------------------------------------------------------------------

class TestCommitStep:
    def test_two_phase_commit(self, executor):
        calls = []
        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                return MagicMock(returncode=1)
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

        executor._commit_step(2, "ui")

        commit_calls = [c for c in calls if c[0] == "commit"]
        assert len(commit_calls) == 2
        assert "feat(mvp):" in commit_calls[0][2]
        assert "chore(mvp):" in commit_calls[1][2]

    def test_no_code_changes_skips_feat_commit(self, executor):
        call_count = {"diff": 0}
        calls = []
        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                call_count["diff"] += 1
                if call_count["diff"] == 1:
                    return MagicMock(returncode=0)
                return MagicMock(returncode=1)
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

        executor._commit_step(2, "ui")

        commit_msgs = [c[2] for c in calls if c[0] == "commit"]
        assert len(commit_msgs) == 1
        assert "chore" in commit_msgs[0]


# ---------------------------------------------------------------------------
# _invoke_codex (mocked)
# ---------------------------------------------------------------------------

class TestInvokeCodex:
    def test_invokes_codex_with_correct_args(self, executor):
        mock_result = MagicMock(returncode=0, stdout='{"result": "ok"}', stderr="")
        step = {"step": 2, "name": "ui"}
        preamble = "PREAMBLE\n"

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            output = executor._invoke_codex(step, preamble)

        cmd = mock_run.call_args[0][0]
        assert cmd[:2] == ["codex", "exec"]
        assert "--dangerously-bypass-approvals-and-sandbox" in cmd
        assert "--dangerously-bypass-hook-trust" in cmd
        assert "--json" in cmd
        assert cmd[-1] == "-"
        prompt = mock_run.call_args[1]["input"]
        assert "PREAMBLE" in prompt
        assert "UI를 구현하세요" in prompt

    def test_saves_output_json(self, executor):
        mock_result = MagicMock(returncode=0, stdout='{"ok": true}', stderr="")
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", return_value=mock_result):
            executor._invoke_codex(step, "preamble")

        output_file = executor._phase_dir / "step2-output.json"
        assert output_file.exists()
        data = json.loads(output_file.read_text())
        assert data["step"] == 2
        assert data["name"] == "ui"
        assert data["exitCode"] == 0

    def test_nonexistent_step_file_exits(self, executor):
        step = {"step": 99, "name": "nonexistent"}
        with pytest.raises(SystemExit) as exc_info:
            executor._invoke_codex(step, "preamble")
        assert exc_info.value.code == 1

    def test_timeout_is_1800(self, executor):
        mock_result = MagicMock(returncode=0, stdout="{}", stderr="")
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            executor._invoke_codex(step, "preamble")

        assert mock_run.call_args[1]["timeout"] == 1800


# ---------------------------------------------------------------------------
# _deploy_preview (--deploy)
# ---------------------------------------------------------------------------

class TestDeployPreview:
    @staticmethod
    def _step(executor, num=2):
        index = json.loads(executor._index_file.read_text())
        return next(s for s in index["steps"] if s["step"] == num)

    def test_runs_vercel_deploy_in_project_root(self, executor):
        mock_result = MagicMock(returncode=0, stdout="https://a.vercel.app\n", stderr="")
        with patch("subprocess.run", return_value=mock_result) as mock_run:
            executor._deploy_preview(2)

        assert mock_run.call_args[0][0] == ["vercel", "deploy", "--yes"]
        assert mock_run.call_args[1]["cwd"] == executor._root

    def test_records_deploy_url_on_success(self, executor):
        mock_result = MagicMock(returncode=0, stdout="https://assetomy-abc.vercel.app\n", stderr="")
        with patch("subprocess.run", return_value=mock_result):
            executor._deploy_preview(2)

        assert self._step(executor)["deploy_url"] == "https://assetomy-abc.vercel.app"

    def test_failure_records_error_without_exit(self, executor):
        mock_result = MagicMock(returncode=1, stdout="", stderr='Error: Command "npm run build" exited with 1')
        with patch("subprocess.run", return_value=mock_result):
            executor._deploy_preview(2)

        step = self._step(executor)
        assert "deploy_url" not in step
        assert "npm run build" in step["deploy_error"]

    def test_missing_cli_records_error(self, executor):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            executor._deploy_preview(2)

        assert "vercel" in self._step(executor)["deploy_error"]

    def test_timeout_records_error(self, executor):
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="vercel", timeout=900)):
            executor._deploy_preview(2)

        assert "시간 초과" in self._step(executor)["deploy_error"]

    def test_success_clears_previous_error(self, executor):
        index = json.loads(executor._index_file.read_text())
        index["steps"][2]["deploy_error"] = "old error"
        executor._index_file.write_text(json.dumps(index))

        mock_result = MagicMock(returncode=0, stdout="https://b.vercel.app\n", stderr="")
        with patch("subprocess.run", return_value=mock_result):
            executor._deploy_preview(2)

        assert "deploy_error" not in self._step(executor)


class TestExecuteSingleStepDeploy:
    @staticmethod
    def _run_completed_step(executor):
        calls = []

        def fake_invoke(step, preamble):
            index = json.loads(executor._index_file.read_text())
            index["steps"][2]["status"] = "completed"
            executor._index_file.write_text(json.dumps(index))

        executor._invoke_codex = fake_invoke
        executor._deploy_preview = lambda num: calls.append("deploy")
        executor._commit_step = lambda num, name: calls.append("commit")
        assert executor._execute_single_step({"step": 2, "name": "ui"}, "guardrails") is True
        return calls

    def test_deploys_before_commit_when_enabled(self, executor):
        executor._auto_deploy = True
        assert self._run_completed_step(executor) == ["deploy", "commit"]

    def test_no_deploy_by_default(self, executor):
        assert self._run_completed_step(executor) == ["commit"]


class TestExecuteSingleStepOutcome:
    @staticmethod
    def _fake_progress(seconds):
        import contextlib
        import types as _types

        @contextlib.contextmanager
        def fake(label):
            info = _types.SimpleNamespace(elapsed=0.0)
            try:
                yield info
            finally:
                info.elapsed = seconds
        return fake

    @staticmethod
    def _set_status(executor, **fields):
        def fake_invoke(step, preamble):
            index = json.loads(executor._index_file.read_text())
            index["steps"][2].update(fields)
            executor._index_file.write_text(json.dumps(index))
        executor._invoke_codex = fake_invoke

    def test_reports_elapsed_after_codex_returns(self, executor, capsys):
        self._set_status(executor, status="completed", summary="done")
        executor._commit_step = lambda num, name: None
        with patch.object(ex, "progress_indicator", self._fake_progress(42.7)):
            executor._execute_single_step({"step": 2, "name": "ui"}, "guardrails")
        assert "[42s]" in capsys.readouterr().out

    def test_blocked_does_not_commit(self, executor, top_index):
        commits = []
        self._set_status(executor, status="blocked", blocked_reason="키 필요")
        executor._commit_step = lambda num, name: commits.append(num)
        with pytest.raises(SystemExit) as exc_info:
            executor._execute_single_step({"step": 2, "name": "ui"}, "guardrails")
        assert exc_info.value.code == 2
        assert commits == []

    def test_error_after_retries_does_not_commit(self, executor, top_index):
        commits = []
        self._set_status(executor, status="error", error_message="AC 실패")
        executor._commit_step = lambda num, name: commits.append(num)
        with pytest.raises(SystemExit) as exc_info:
            executor._execute_single_step({"step": 2, "name": "ui"}, "guardrails")
        assert exc_info.value.code == 1
        assert commits == []


# ---------------------------------------------------------------------------
# progress_indicator (= 이전 Spinner)
# ---------------------------------------------------------------------------

class TestProgressIndicator:
    def test_context_manager(self):
        import time
        with ex.progress_indicator("test") as pi:
            time.sleep(0.15)
        assert pi.elapsed >= 0.1

    def test_elapsed_increases(self):
        import time
        with ex.progress_indicator("test") as pi:
            time.sleep(0.2)
        assert pi.elapsed > 0


# ---------------------------------------------------------------------------
# main() CLI 파싱 (mocked)
# ---------------------------------------------------------------------------

class TestMainCli:
    def test_no_args_exits(self):
        with patch("sys.argv", ["execute.py"]):
            with pytest.raises(SystemExit) as exc_info:
                ex.main()
            assert exc_info.value.code == 2  # argparse exits with 2

    def test_invalid_phase_dir_exits(self):
        with patch("sys.argv", ["execute.py", "nonexistent"]):
            with patch.object(ex, "ROOT", Path("/tmp/fake_nonexistent")):
                with pytest.raises(SystemExit) as exc_info:
                    ex.main()
                assert exc_info.value.code == 1

    def test_missing_index_exits(self, tmp_project):
        (tmp_project / "phases" / "empty").mkdir()
        with patch("sys.argv", ["execute.py", "empty"]):
            with patch.object(ex, "ROOT", tmp_project):
                with pytest.raises(SystemExit) as exc_info:
                    ex.main()
                assert exc_info.value.code == 1

    def test_deploy_flag_enables_auto_deploy(self):
        with patch("sys.argv", ["execute.py", "0-mvp", "--deploy"]):
            with patch.object(ex, "StepExecutor") as mock_cls:
                ex.main()
        mock_cls.assert_called_once_with("0-mvp", auto_push=False, auto_deploy=True, resume=False)

    def test_resume_flag_enables_resume(self):
        with patch("sys.argv", ["execute.py", "0-mvp", "--resume"]):
            with patch.object(ex, "StepExecutor") as mock_cls:
                ex.main()
        mock_cls.assert_called_once_with("0-mvp", auto_push=False, auto_deploy=False, resume=True)


# ---------------------------------------------------------------------------
# _check_blockers (= 이전 main() error/blocked 체크)
# ---------------------------------------------------------------------------

class TestCheckBlockers:
    def _make_executor_with_steps(self, tmp_project, steps):
        d = tmp_project / "phases" / "test-phase"
        d.mkdir(exist_ok=True)
        index = {"project": "T", "phase": "test", "steps": steps}
        (d / "index.json").write_text(json.dumps(index))

        with patch.object(ex, "ROOT", tmp_project):
            inst = ex.StepExecutor.__new__(ex.StepExecutor)
        inst._root = str(tmp_project)
        inst._phases_dir = tmp_project / "phases"
        inst._phase_dir = d
        inst._phase_dir_name = "test-phase"
        inst._index_file = d / "index.json"
        inst._top_index_file = tmp_project / "phases" / "index.json"
        inst._phase_name = "test"
        inst._total = len(steps)
        inst._resume = False
        return inst

    @staticmethod
    def _write_top(tmp_project, entry):
        p = tmp_project / "phases" / "index.json"
        p.write_text(json.dumps({"phases": [entry, {"dir": "other", "status": "blocked", "blocked_at": "x"}]}))
        return p

    def test_blocked_message_suggests_resume(self, tmp_project, capsys):
        steps = [{"step": 0, "name": "stuck", "status": "blocked", "blocked_reason": "push 필요"}]
        inst = self._make_executor_with_steps(tmp_project, steps)
        with pytest.raises(SystemExit):
            inst._check_blockers()
        assert "--resume" in capsys.readouterr().out

    def test_resume_resets_blocked_step_and_phase(self, tmp_project):
        steps = [
            {"step": 0, "name": "ok", "status": "completed"},
            {"step": 1, "name": "stuck", "status": "blocked", "blocked_reason": "push 필요",
             "blocked_at": "2026-10-13T08:33:47+0900", "started_at": "2026-10-13T08:29:17+0900"},
        ]
        inst = self._make_executor_with_steps(tmp_project, steps)
        top = self._write_top(tmp_project, {"dir": "test-phase", "status": "blocked", "blocked_at": "t"})
        inst._resume = True
        inst._check_blockers()

        step = json.loads(inst._index_file.read_text())["steps"][1]
        assert step["status"] == "pending"
        assert "blocked_reason" not in step and "blocked_at" not in step
        assert step["started_at"] == "2026-10-13T08:29:17+0900"
        phases = json.loads(top.read_text())["phases"]
        assert phases[0] == {"dir": "test-phase", "status": "pending"}
        assert phases[1]["status"] == "blocked"  # 다른 phase는 그대로

    def test_resume_resets_error_step(self, tmp_project):
        steps = [{"step": 0, "name": "bad", "status": "error", "error_message": "fail", "failed_at": "t"}]
        inst = self._make_executor_with_steps(tmp_project, steps)
        self._write_top(tmp_project, {"dir": "test-phase", "status": "error", "failed_at": "t"})
        inst._resume = True
        inst._check_blockers()

        step = json.loads(inst._index_file.read_text())["steps"][0]
        assert step["status"] == "pending"
        assert "error_message" not in step and "failed_at" not in step

    def test_resume_without_blocker_is_noop(self, tmp_project):
        steps = [{"step": 0, "name": "ok", "status": "completed"}, {"step": 1, "name": "next", "status": "pending"}]
        inst = self._make_executor_with_steps(tmp_project, steps)
        before = inst._index_file.read_text()
        inst._resume = True
        inst._check_blockers()
        assert inst._index_file.read_text() == before

    def test_error_step_exits_1(self, tmp_project):
        steps = [
            {"step": 0, "name": "ok", "status": "completed"},
            {"step": 1, "name": "bad", "status": "error", "error_message": "fail"},
        ]
        inst = self._make_executor_with_steps(tmp_project, steps)
        with pytest.raises(SystemExit) as exc_info:
            inst._check_blockers()
        assert exc_info.value.code == 1

    def test_blocked_step_exits_2(self, tmp_project):
        steps = [
            {"step": 0, "name": "ok", "status": "completed"},
            {"step": 1, "name": "stuck", "status": "blocked", "blocked_reason": "API key"},
        ]
        inst = self._make_executor_with_steps(tmp_project, steps)
        with pytest.raises(SystemExit) as exc_info:
            inst._check_blockers()
        assert exc_info.value.code == 2
