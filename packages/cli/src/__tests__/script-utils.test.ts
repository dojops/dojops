import { describe, it, expect } from "vitest";
import {
  isShellScript,
  isPythonScript,
  isPowerShellScript,
  isScriptFile,
  checkShebang,
  makeExecutable,
} from "../script-utils";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("isShellScript", () => {
  it("recognizes .sh files", () => {
    expect(isShellScript("backup.sh")).toBe(true);
    expect(isShellScript("/usr/local/bin/deploy.sh")).toBe(true);
  });

  it("recognizes .bash and .zsh files", () => {
    expect(isShellScript("setup.bash")).toBe(true);
    expect(isShellScript("init.zsh")).toBe(true);
  });

  it("rejects non-shell files", () => {
    expect(isShellScript("main.py")).toBe(false);
    expect(isShellScript("script.ps1")).toBe(false);
    expect(isShellScript("config.json")).toBe(false);
  });
});

describe("isPythonScript", () => {
  it("recognizes .py files", () => {
    expect(isPythonScript("migrate.py")).toBe(true);
    expect(isPythonScript("scripts/deploy.py")).toBe(true);
  });

  it("rejects non-Python files", () => {
    expect(isPythonScript("deploy.sh")).toBe(false);
    expect(isPythonScript("module.ps1")).toBe(false);
  });
});

describe("isPowerShellScript", () => {
  it("recognizes .ps1 and .psm1 files", () => {
    expect(isPowerShellScript("deploy.ps1")).toBe(true);
    expect(isPowerShellScript("utils.psm1")).toBe(true);
  });

  it("rejects non-PowerShell files", () => {
    expect(isPowerShellScript("deploy.sh")).toBe(false);
    expect(isPowerShellScript("main.py")).toBe(false);
  });
});

describe("isScriptFile", () => {
  it("recognizes all script types", () => {
    expect(isScriptFile("backup.sh")).toBe(true);
    expect(isScriptFile("deploy.py")).toBe(true);
    expect(isScriptFile("setup.ps1")).toBe(true);
    expect(isScriptFile("init.bash")).toBe(true);
  });

  it("rejects non-script files", () => {
    expect(isScriptFile("main.tf")).toBe(false);
    expect(isScriptFile("Dockerfile")).toBe(false);
    expect(isScriptFile("config.yaml")).toBe(false);
  });
});

describe("checkShebang", () => {
  it("returns null when shebang is present for shell scripts", () => {
    const content = '#!/usr/bin/env bash\nset -euo pipefail\necho "hello"';
    expect(checkShebang(content, "deploy.sh")).toBeNull();
  });

  it("returns null when shebang is present for Python scripts", () => {
    const content = '#!/usr/bin/env python3\nprint("hello")';
    expect(checkShebang(content, "migrate.py")).toBeNull();
  });

  it("returns warning when shebang is missing for shell scripts", () => {
    const content = 'set -euo pipefail\necho "hello"';
    const warning = checkShebang(content, "deploy.sh");
    expect(warning).toContain("shell script missing shebang");
    expect(warning).toContain("#!/usr/bin/env bash");
  });

  it("returns warning when shebang is missing for Python scripts", () => {
    const content = 'print("hello")';
    const warning = checkShebang(content, "migrate.py");
    expect(warning).toContain("Python script missing shebang");
    expect(warning).toContain("#!/usr/bin/env python3");
  });

  it("returns null for non-script files", () => {
    expect(checkShebang("some content", "config.yaml")).toBeNull();
    expect(checkShebang("some content", "main.tf")).toBeNull();
  });

  it("handles empty content", () => {
    const warning = checkShebang("", "deploy.sh");
    expect(warning).toContain("missing shebang");
  });
});

describe("makeExecutable", () => {
  it("sets execute permission on .sh files", () => {
    if (process.platform === "win32") return; // Skip on Windows

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "script-test-"));
    const scriptPath = path.join(tmpDir, "test.sh");
    fs.writeFileSync(scriptPath, "#!/bin/bash\necho hello", "utf-8");

    const result = makeExecutable(scriptPath);
    expect(result).toBe(true);

    const stat = fs.statSync(scriptPath);
    // Check that owner execute bit is set
    expect(stat.mode & 0o100).toBeTruthy();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false for non-shell files", () => {
    expect(makeExecutable("script.py")).toBe(false);
    expect(makeExecutable("script.ps1")).toBe(false);
    expect(makeExecutable("config.json")).toBe(false);
  });

  it("returns false for nonexistent files", () => {
    expect(makeExecutable("/nonexistent/path/script.sh")).toBe(false);
  });
});
