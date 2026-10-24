import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const player = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdk =
  process.env.ANDROID_HOME ??
  join(homedir(), ".local/share/teluni-android-sdk");
const java =
  process.env.JAVA_HOME ??
  join(homedir(), ".local/share/teluni-toolchains/jdk17");
const avd = process.env.TELUNI_PLAYER_AVD ?? "teluni-tv-api36";
const serial = process.env.ANDROID_SERIAL ?? "emulator-5554";
const adb = join(
  sdk,
  "platform-tools",
  process.platform === "win32" ? "adb.exe" : "adb",
);
const emulator = join(
  sdk,
  "emulator",
  process.platform === "win32" ? "emulator.exe" : "emulator",
);
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  JAVA_HOME: java,
  GRADLE_USER_HOME:
    process.env.GRADLE_USER_HOME ??
    join(homedir(), ".cache/teluni-player-gradle"),
  PATH: `${join(java, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env,
    cwd: player,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${command}`);
}

function deviceReady() {
  try {
    return (
      execFileSync(
        adb,
        ["-s", serial, "shell", "getprop", "sys.boot_completed"],
        {
          env,
          timeout: 5000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .toString()
        .trim() === "1"
    );
  } catch {
    return false;
  }
}

try {
  if (
    !existsSync(adb) ||
    !existsSync(
      join(java, "bin", process.platform === "win32" ? "java.exe" : "java"),
    )
  ) {
    throw new Error(
      "Android SDK and JDK 17 are required. See apps/player/README.md; ANDROID_HOME and JAVA_HOME override local defaults.",
    );
  }
  run(process.platform === "win32" ? "gradlew.bat" : "./gradlew", [
    "--no-daemon",
    ":app:assembleDebug",
  ]);
  if (!deviceReady()) {
    if (!serial.startsWith("emulator-"))
      throw new Error("The selected Android device is unavailable.");
    const port = Number(serial.slice("emulator-".length));
    if (!Number.isInteger(port) || port < 5554 || port > 5682 || port % 2 !== 0)
      throw new Error("Invalid emulator port.");
    const cache = join(homedir(), ".cache", "teluni-player");
    mkdirSync(cache, { recursive: true });
    const log = openSync(join(cache, "emulator.log"), "a", 0o600);
    const child = spawn(
      emulator,
      [
        "-avd",
        avd,
        "-port",
        String(port),
        "-gpu",
        "swiftshader",
        "-no-boot-anim",
        "-memory",
        "2048",
        "-cores",
        "2",
      ],
      { env, detached: true, stdio: ["ignore", log, log] },
    );
    child.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.unref();
    console.log("Waiting for Android TV to boot…");
    const deadline = Date.now() + 240_000;
    while (!deviceReady()) {
      if (Date.now() > deadline)
        throw new Error(
          "Android TV did not boot within four minutes. Inspect ~/.cache/teluni-player/emulator.log.",
        );
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  }
  run(adb, [
    "-s",
    serial,
    "install",
    "-r",
    join(player, "app/build/outputs/apk/debug/app-debug.apk"),
  ]);
  run(adb, [
    "-s",
    serial,
    "shell",
    "am",
    "start",
    "-n",
    "app.teluni.player/.PlayerActivity",
  ]);
  console.log(
    "Teluni Player is open. Connect to the API, then pair its code in the panel's Screens page.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
