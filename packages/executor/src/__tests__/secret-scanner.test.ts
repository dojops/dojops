import { describe, it, expect } from "vitest";
import { scanForSecrets } from "../secret-scanner";

describe("scanForSecrets", () => {
  describe("detects AWS keys", () => {
    it("detects AWS access key ID", () => {
      const content = 'aws_access_key_id = "AKIAIOSFODNN7EXAMPLE"';
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("AWS Access Key ID");
      expect(matches[0].line).toBe(1);
    });

    it("detects AWS key on specific line", () => {
      const content = "line 1\nline 2\nAKIAIOSFODNN7EXAMPLE\nline 4";
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].line).toBe(3);
    });
  });

  describe("detects GitHub tokens", () => {
    it("detects GitHub personal access token (ghp_)", () => {
      const content = 'token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"';
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("GitHub Personal Access Token");
    });

    it("detects GitHub OAuth token (gho_)", () => {
      const content = "GITHUB_TOKEN=gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("GitHub OAuth Token");
    });

    it("detects GitHub App token (ghs_)", () => {
      const content = "token: ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("GitHub App Token");
    });

    it("detects GitHub fine-grained PAT", () => {
      const content = "token: github_pat_ABCDEFGHIJKLMNOPQRSTUVy";
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("GitHub Fine-Grained PAT");
    });
  });

  describe("detects generic API keys", () => {
    it("detects sk- prefixed API keys", () => {
      const content = 'api_key = "sk-abcdefghijklmnopqrstuvwxyz"';
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("Generic API Key (sk-)");
    });
  });

  describe("detects private keys", () => {
    it("detects RSA private key header", () => {
      const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAK...";
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("Private Key");
      expect(matches[0].line).toBe(1);
    });

    it("detects EC private key header", () => {
      const content = "-----BEGIN EC PRIVATE KEY-----";
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("Private Key");
    });

    it("detects generic private key header", () => {
      const content = "-----BEGIN PRIVATE KEY-----";
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("Private Key");
    });
  });

  describe("detects hardcoded credentials", () => {
    it("detects password assignments with double quotes", () => {
      const content = 'password = "my-secret-password"';
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("Hardcoded password");
    });

    it("detects password assignments with single quotes", () => {
      const content = "password = 'my-secret-password'";
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("Hardcoded password");
    });

    it("detects secret assignments", () => {
      const content = 'secret = "super-secret-value"';
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(1);
      expect(matches[0].pattern).toBe("Hardcoded secret");
    });
  });

  describe("handles clean content", () => {
    it("returns empty array for clean content", () => {
      const content = `
resource "aws_s3_bucket" "example" {
  bucket = "my-bucket"
  acl    = "private"
}
`;
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(0);
    });

    it("returns empty array for empty content", () => {
      const matches = scanForSecrets("");
      expect(matches).toHaveLength(0);
    });

    it("does not flag env var references (no hardcoded value)", () => {
      const content = "password = process.env.DB_PASSWORD";
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(0);
    });
  });

  describe("handles multiple secrets", () => {
    it("detects multiple secrets on different lines", () => {
      const content = [
        'aws_key = "AKIAIOSFODNN7EXAMPLE"',
        'token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"',
        'secret = "my-secret"',
      ].join("\n");
      const matches = scanForSecrets(content);
      expect(matches).toHaveLength(3);
      expect(matches[0].line).toBe(1);
      expect(matches[1].line).toBe(2);
      expect(matches[2].line).toBe(3);
    });
  });
});
