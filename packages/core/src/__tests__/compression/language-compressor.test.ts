import { describe, it, expect } from "vitest";
import { compressSourceCode, compressFileContents } from "../../compression/language-compressor";

// ── TypeScript / JavaScript ──────────────────────────────────────

describe("compressSourceCode — TypeScript", () => {
  it("preserves imports and type declarations", () => {
    const code = `import { foo } from "bar";
import type { Baz } from "./baz";

export interface Config {
  name: string;
  value: number;
}

export type Status = "active" | "inactive";`;

    const result = compressSourceCode(code, "test.ts");
    expect(result.language).toBe("typescript");
    expect(result.output).toContain('import { foo } from "bar"');
    expect(result.output).toContain("export interface Config");
    expect(result.output).toContain("name: string");
    expect(result.output).toContain("export type Status");
  });

  it("strips function bodies, keeps signatures", () => {
    const code = `export function add(a: number, b: number): number {
  const result = a + b;
  console.log(result);
  return result;
}

export async function fetchData(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("fail");
  return res;
}`;

    const result = compressSourceCode(code, "math.ts");
    expect(result.output).toContain("export function add(a: number, b: number): number {");
    expect(result.output).toContain("// ... (body omitted)");
    expect(result.output).not.toContain("console.log(result)");
    expect(result.output).toContain("export async function fetchData");
    expect(result.output).not.toContain("await fetch(url)");
    expect(result.ratio).toBeLessThan(0.7);
  });

  it("keeps class declarations and method signatures", () => {
    const code = `export class UserService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.init();
  }

  async findById(id: string): Promise<User> {
    const user = await this.db.query("SELECT * FROM users WHERE id = ?", [id]);
    if (!user) throw new NotFoundError();
    return user;
  }
}`;

    const result = compressSourceCode(code, "service.ts");
    expect(result.output).toContain("export class UserService");
    expect(result.output).toContain("constructor(db: Database)");
    expect(result.output).toContain("async findById(id: string): Promise<User>");
    expect(result.output).not.toContain("SELECT * FROM users");
  });

  it("handles arrow functions", () => {
    const code = `export const multiply = (a: number, b: number): number => {
  return a * b;
};

export const greet = async (name: string) => {
  const greeting = "Hello " + name;
  return greeting;
};`;

    const result = compressSourceCode(code, "utils.ts");
    expect(result.output).toContain("export const multiply = (a: number, b: number): number =>");
    expect(result.output).not.toContain("return a * b");
  });
});

// ── Python ───────────────────────────────────────────────────────

describe("compressSourceCode — Python", () => {
  it("preserves imports and class definitions", () => {
    const code = `import os
from typing import Optional, List
from dataclasses import dataclass

@dataclass
class Config:
    name: str
    value: int = 0`;

    const result = compressSourceCode(code, "config.py");
    expect(result.language).toBe("python");
    expect(result.output).toContain("import os");
    expect(result.output).toContain("from typing import Optional, List");
    expect(result.output).toContain("@dataclass");
    expect(result.output).toContain("class Config:");
  });

  it("strips function bodies, keeps signatures and docstrings", () => {
    const code = `def process_data(items: list[str], threshold: int = 10) -> dict:
    """Process items and return filtered results."""
    result = {}
    for item in items:
        if len(item) > threshold:
            result[item] = len(item)
    return result

async def fetch_user(user_id: str) -> User:
    response = await client.get(f"/users/{user_id}")
    return User(**response.json())`;

    const result = compressSourceCode(code, "utils.py");
    expect(result.output).toContain(
      "def process_data(items: list[str], threshold: int = 10) -> dict:",
    );
    expect(result.output).toContain('"""Process items and return filtered results."""');
    expect(result.output).toContain("# ... (body omitted)");
    expect(result.output).not.toContain("for item in items");
    expect(result.output).toContain("async def fetch_user(user_id: str) -> User:");
    expect(result.output).not.toContain("response = await");
  });
});

// ── Go ───────────────────────────────────────────────────────────

describe("compressSourceCode — Go", () => {
  it("preserves package, imports, and type declarations", () => {
    const code = `package main

import (
\t"fmt"
\t"net/http"
)

type Server struct {
\tport int
\thost string
}`;

    const result = compressSourceCode(code, "main.go");
    expect(result.language).toBe("go");
    expect(result.output).toContain("package main");
    expect(result.output).toContain('"fmt"');
    expect(result.output).toContain("type Server struct");
    expect(result.output).toContain("port int");
  });

  it("strips function bodies, keeps signatures", () => {
    const code = `func (s *Server) Start() error {
\tlistener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", s.host, s.port))
\tif err != nil {
\t\treturn err
\t}
\treturn http.Serve(listener, s.handler)
}

func NewServer(port int) *Server {
\treturn &Server{port: port, host: "localhost"}
}`;

    const result = compressSourceCode(code, "server.go");
    expect(result.output).toContain("func (s *Server) Start() error {");
    expect(result.output).toContain("// ... (body omitted)");
    expect(result.output).not.toContain("net.Listen");
    expect(result.output).toContain("func NewServer(port int) *Server {");
    expect(result.output).not.toContain("localhost");
  });
});

// ── Rust ─────────────────────────────────────────────────────────

describe("compressSourceCode — Rust", () => {
  it("preserves use statements and struct definitions", () => {
    const code = `use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct Config {
    pub name: String,
    pub value: i32,
}`;

    const result = compressSourceCode(code, "lib.rs");
    expect(result.language).toBe("rust");
    expect(result.output).toContain("use std::collections::HashMap");
    expect(result.output).toContain("#[derive(Debug, Serialize)]");
    expect(result.output).toContain("pub struct Config");
    expect(result.output).toContain("pub name: String");
  });

  it("strips fn bodies, keeps signatures", () => {
    const code = `pub fn process(data: &[u8]) -> Result<Vec<u8>, Error> {
    let mut output = Vec::new();
    for byte in data {
        output.push(byte ^ 0xFF);
    }
    Ok(output)
}

pub async fn fetch(url: &str) -> Result<Response, reqwest::Error> {
    let client = reqwest::Client::new();
    client.get(url).send().await
}`;

    const result = compressSourceCode(code, "handler.rs");
    expect(result.output).toContain("pub fn process(data: &[u8]) -> Result<Vec<u8>, Error> {");
    expect(result.output).toContain("// ... (body omitted)");
    expect(result.output).not.toContain("Vec::new()");
    expect(result.output).toContain("pub async fn fetch");
  });
});

// ── Java ─────────────────────────────────────────────────────────

describe("compressSourceCode — Java", () => {
  it("preserves imports and class structure", () => {
    const code = `package com.example;

import java.util.List;
import java.util.Map;

public class UserService {
    private final Database db;

    public UserService(Database db) {
        this.db = db;
        this.init();
    }

    public User findById(String id) {
        var user = db.query("SELECT * FROM users WHERE id = ?", id);
        if (user == null) throw new NotFoundException();
        return user;
    }
}`;

    const result = compressSourceCode(code, "UserService.java");
    expect(result.language).toBe("java");
    expect(result.output).toContain("package com.example");
    expect(result.output).toContain("import java.util.List");
    expect(result.output).toContain("public class UserService");
    expect(result.output).toContain("public UserService(Database db)");
    expect(result.output).toContain("public User findById(String id)");
    expect(result.output).not.toContain("SELECT * FROM users");
  });
});

// ── Config files (passthrough) ───────────────────────────────────

describe("compressSourceCode — config files", () => {
  it("passes through JSON unchanged", () => {
    const json = '{"name": "test", "version": "1.0.0"}';
    const result = compressSourceCode(json, "package.json");
    expect(result.language).toBe("config");
    expect(result.output).toBe(json);
    expect(result.ratio).toBe(1);
  });

  it("passes through YAML unchanged", () => {
    const yaml = "name: test\nversion: 1.0.0\n";
    const result = compressSourceCode(yaml, "config.yml");
    expect(result.language).toBe("config");
    expect(result.output).toBe(yaml);
  });

  it("passes through Markdown unchanged", () => {
    const md = "# README\n\nSome documentation text.";
    const result = compressSourceCode(md, "README.md");
    expect(result.language).toBe("config");
    expect(result.output).toBe(md);
  });
});

// ── Unknown files (passthrough) ──────────────────────────────────

describe("compressSourceCode — unknown extensions", () => {
  it("passes through unknown file types", () => {
    const content = "some arbitrary content";
    const result = compressSourceCode(content, "data.xyz");
    expect(result.language).toBe("unknown");
    expect(result.output).toBe(content);
  });
});

// ── Batch compression ────────────────────────────────────────────

describe("compressFileContents", () => {
  it("compresses multiple files and reports aggregate stats", () => {
    const files = [
      {
        path: "src/index.ts",
        content: `import { foo } from "bar";\nexport function run() {\n  foo();\n  foo();\n  return 42;\n}\n`,
      },
      { path: "config.json", content: '{"key": "value"}' },
    ];

    const result = compressFileContents(files);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].language).toBe("typescript");
    expect(result.files[1].language).toBe("config");
    expect(result.totalOriginal).toBeGreaterThan(0);
    expect(result.ratio).toBeLessThanOrEqual(1);
  });
});
