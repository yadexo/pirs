import { describe, it, expect } from "vitest";
import { describeAwsError } from "@/prisma/storage-check";

/**
 * The hint attached to each AWS error code. Unit-tested against fabricated
 * errors rather than live S3, because LocalStack (tests/integration/s3-storage.test.ts)
 * doesn't enforce signature validation by default and can't produce a real
 * SignatureDoesNotMatch to assert against.
 */
describe("explaining an S3 failure", () => {
  const awsError = (Code: string, httpStatusCode?: number) => ({ name: Code, Code, message: `${Code} happened`, $metadata: { httpStatusCode } });

  it("points at credentials or region for a signature mismatch", () => {
    expect(describeAwsError(awsError("SignatureDoesNotMatch", 403))).toMatch(/S3_ACCESS_KEY_ID.*S3_SECRET_ACCESS_KEY.*S3_REGION/s);
  });

  it("points at S3_BUCKET when the bucket doesn't exist", () => {
    expect(describeAwsError(awsError("NoSuchBucket", 404))).toMatch(/does not exist/);
  });

  it("points at permissions for a valid key with no access", () => {
    expect(describeAwsError(awsError("AccessDenied", 403))).toMatch(/lacks s3:PutObject/);
  });

  it("points at region or endpoint for a redirect", () => {
    expect(describeAwsError(awsError("PermanentRedirect", 301))).toMatch(/S3_REGION or S3_ENDPOINT/);
  });

  it("includes the HTTP status when AWS gives one", () => {
    expect(describeAwsError(awsError("AccessDenied", 403))).toContain("HTTP 403");
  });

  it("falls back to the code and message for anything not specifically explained", () => {
    expect(describeAwsError(awsError("SlowDown"))).toBe("SlowDown: SlowDown happened");
  });

  it("doesn't choke on something that isn't a structured AWS error", () => {
    // A plain Error's own .name ("Error") is still more useful than nothing.
    expect(describeAwsError(new Error("plain network failure"))).toBe("Error: plain network failure");
    expect(describeAwsError("a bare string")).toBe("UnknownError: a bare string");
  });
});
