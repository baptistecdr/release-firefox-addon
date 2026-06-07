import fs from "node:fs";
import timers from "node:timers/promises";
import * as core from "@actions/core";
import { AMOClient, type Compatibility, isLicense, LICENSE_NAMES, type VersionRange } from "./amo";

const CHECK_ADDON_STATUS_INTERVAL = 3000;
const CHECK_ADDON_STATUS_TIMEOUT = 20000;

async function run(): Promise<void> {
  const addonId = core.getInput("addon-id");
  const addonPath = core.getInput("addon-path");
  const sourcePath = core.getInput("source-path") || undefined;
  const approvalNote = core.getInput("approval-note") || undefined;
  const compatibility = core.getInput("compatibility");
  const compatibilityFirefoxMin = core.getInput("compatibility-firefox-min") || undefined;
  const compatibilityFirefoxMax = core.getInput("compatibility-firefox-max") || undefined;
  const compatibilityFirefoxAndroidMin = core.getInput("compatibility-firefox-android-min") || undefined;
  const compatibilityFirefoxAndroidMax = core.getInput("compatibility-firefox-android-max") || undefined;
  const license = core.getInput("license") || undefined;
  const releaseNote = core.getInput("release-note");
  const channel = core.getInput("channel") || undefined;
  const authIssuer = core.getInput("auth-api-issuer");
  const authSecret = core.getInput("auth-api-secret");

  const compatibilities = compatibility.split(",").map((c) => c.trim());

  if (compatibilities.some((c) => c !== "firefox" && c !== "android")) {
    throw new Error(`Invalid compatibility "${compatibility}". Must be "firefox" or "android"`);
  }

  if (typeof license !== "undefined" && !isLicense(license)) {
    throw new Error(`Invalid license "${license}". Must be one of: ${Object.keys(LICENSE_NAMES).join(", ")}`);
  }

  if (channel !== "listed" && channel !== "unlisted") {
    throw new Error(`Invalid channel "${channel}". Must be "listed" or "unlisted"`);
  }

  const firefoxCompatibility: VersionRange = {
    min: compatibilityFirefoxMin,
    max: compatibilityFirefoxMax,
  };
  const firefoxAndroidCompatibility: VersionRange = {
    min: compatibilityFirefoxAndroidMin,
    max: compatibilityFirefoxAndroidMax,
  };
  const createVersionRequestCompatibility: Compatibility = {};

  if (compatibilities.includes("firefox")) {
    createVersionRequestCompatibility.firefox = firefoxCompatibility;
  }
  if (compatibilities.includes("android")) {
    createVersionRequestCompatibility.android = firefoxAndroidCompatibility;
  }

  const client = new AMOClient({
    auth: {
      issuer: authIssuer,
      secret: authSecret,
    },
  });

  const addonZip = await fs.openAsBlob(addonPath);
  const upload = await client.uploadAddon(addonZip, channel);

  core.info(`Addon "${addonPath}" has been uploaded with UUID "${upload.uuid}"`);

  for await (const startTime of timers.setInterval(CHECK_ADDON_STATUS_INTERVAL, Date.now())) {
    const status = await client.getUpload(upload.uuid);

    if (status.processed) {
      break;
    }

    if (Date.now() - startTime > CHECK_ADDON_STATUS_TIMEOUT) {
      throw new Error("timed-out waiting for addon to be processed");
    }
  }
  core.info(`Addon "${upload.uuid}" has been processed`);

  let version = await client.getVersionOrUndefined(addonId, upload.version);
  if (typeof version === "undefined") {
    version = await client.createVersion(addonId, {
      approval_notes: approvalNote,
      compatibility: createVersionRequestCompatibility,
      license: license,
      release_notes: {
        "en-US": releaseNote,
      },
      upload: upload.uuid,
    });
    core.info(`Version "${version.version}" has been created`);
  } else {
    core.info(`Version "${version.version}" already exists`);
  }

  if (sourcePath) {
    const sourceZip = await fs.openAsBlob(sourcePath);
    const src = await client.uploadSource(addonId, version.version, sourceZip, license);
    core.info(`Source "${sourcePath}" has been uploaded to "${src.source}"`);
  }

  core.setOutput("version", version.version);
  core.setOutput("version-id", version.id);
  core.setOutput("version-edit-url", version.edit_url);

  core.info(`Version "${version.version}" has been published`);
}

(async () => {
  try {
    await run();
  } catch (error) {
    core.setFailed(String(error));
  }
})();
