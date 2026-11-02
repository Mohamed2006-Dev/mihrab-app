#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
       Mihrab build automation (Mihrab Build Automation Pipeline)
       Checks dependencies, cleans stale processes and packages the Windows executable.
===============================================================================
"""

import os
import sys
import time
import json
import shutil
import struct
import zlib
import argparse
import subprocess
from pathlib import Path

# Enable immediate console output (Unbuffered / Line Buffering)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(line_buffering=True)

# Enable ANSI colors on Windows (Windows Virtual Terminal)
if sys.platform == "win32":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        pass

# Console colors
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    RESET = '\033[0m'

PROJECT_ROOT = Path(__file__).resolve().parent
DIST_DIR = PROJECT_ROOT / "dist"
PACKAGE_JSON = PROJECT_ROOT / "package.json"
NODE_MODULES = PROJECT_ROOT / "node_modules"
ASSETS_DIR = PROJECT_ROOT / "src" / "ui" / "assets"
ICON_ICO = ASSETS_DIR / "app-icon.ico"
ICON_PNG = ASSETS_DIR / "app-icon.png"

def log_header(msg: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*72}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}  {msg}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'='*72}{Colors.RESET}\n")

def log_info(msg: str):
    print(f"{Colors.BLUE}[i]{Colors.RESET} {msg}")

def log_success(msg: str):
    print(f"{Colors.GREEN}[✓]{Colors.RESET} {msg}")

def log_warning(msg: str):
    print(f"{Colors.YELLOW}[!] {msg}{Colors.RESET}")

def log_error(msg: str):
    print(f"{Colors.RED}[✗] {msg}{Colors.RESET}")

def print_banner():
    banner = f"""{Colors.BOLD}{Colors.CYAN}
    ╔═════════════════════════════════════════════════════════════════╗
    ║                                                                 ║
    ║        🕌  Mihrab Windows build automation        ║
    ║        Mihrab Desktop Executable (.exe) Build Pipeline          ║
    ║                                                                 ║
    ╚═════════════════════════════════════════════════════════════════╝{Colors.RESET}
    """
    print(banner)

# =============================================================================
# 1. Stop stale processes to avoid locked files (Process Cleanup)
# =============================================================================
def cleanup_running_processes():
    log_info("Checking stale processes to prevent locked-file errors (EPERM / File Lock)...")
    target_processes = [
        "electron.exe",
        "Mihrab.exe",
        "mihrab-desktop.exe",
        "Mihrab-Portable.exe"
    ]
    
    killed_any = False
    if sys.platform == "win32":
        for proc in target_processes:
            try:
                res = subprocess.run(
                    ["taskkill", "/F", "/IM", proc, "/T"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    check=False
                )
                if res.returncode == 0:
                    killed_any = True
                    log_success(f"Stopped stale process: {proc}")
            except Exception:
                pass
    else:
        for proc in target_processes:
            try:
                subprocess.run(["pkill", "-f", proc], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            except Exception:
                pass

    if not killed_any:
        log_success("No stale processes found. Workspace ready.")

# =============================================================================
# 2. Check build dependencies and assets (Dependencies & Icon Check)
# =============================================================================
def ensure_app_icons():
    """Ensure the application icon exists; generate a 256x256 icon when missing."""
    if ICON_ICO.exists() and ICON_PNG.exists() and ICON_ICO.stat().st_size > 1000:
        log_success("Application icons are ready (app-icon.ico / app-icon.png).")
        return

    log_info("Generating the 256x256 application icon...")
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    def crc32(buf):
        return zlib.crc32(buf) & 0xffffffff

    def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
        length = struct.pack(">I", len(data))
        crc = struct.pack(">I", crc32(chunk_type + data))
        return length + chunk_type + data + crc

    size = 256
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = make_chunk(b'IHDR', struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))

    raw_rows = []
    cx = size / 2
    cy = size / 2
    r = size / 2 - 4

    for y in range(size):
        row = bytearray([0]) # Filter byte = 0
        for x in range(size):
            dist = ((x - cx)**2 + (y - cy)**2)**0.5
            moon_d1 = ((x - (size * 0.46))**2 + (y - (size * 0.50))**2)**0.5
            moon_d2 = ((x - (size * 0.59))**2 + (y - (size * 0.44))**2)**0.5
            is_crescent = moon_d1 <= (size * 0.32) and moon_d2 >= (size * 0.26)
            star_d = ((x - (size * 0.62))**2 + (y - (size * 0.35))**2)**0.5
            is_star = star_d <= (size * 0.08)

            if dist <= r:
                if is_crescent or is_star:
                    row.extend([207, 169, 79, 255]) # Gold #cfa94f
                elif dist >= r - 4:
                    row.extend([207, 169, 79, 220]) # Border
                else:
                    row.extend([6, 9, 18, 245])     # Deep nocturnal navy #060912
            else:
                row.extend([0, 0, 0, 0])
        raw_rows.append(bytes(row))

    compressed = zlib.compress(b"".join(raw_rows))
    idat = make_chunk(b'IDAT', compressed)
    iend = make_chunk(b'IEND', b"")
    png_data = sig + ihdr + idat + iend

    with open(ICON_PNG, "wb") as f:
        f.write(png_data)

    # Wrap PNG into ICO container
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png_data), 22)
    ico_data = header + entry + png_data

    with open(ICON_ICO, "wb") as f:
        f.write(ico_data)

    log_success(f"Created application icons: {ICON_ICO.name} ({len(ico_data)} bytes).")

def check_and_prepare_dependencies():
    log_info("Checking dependencies in package.json...")
    
    if not PACKAGE_JSON.exists():
        log_error(f"Missing package file: {PACKAGE_JSON}")
        sys.exit(1)

    with open(PACKAGE_JSON, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    dirty = False
    scripts = pkg.setdefault("scripts", {})
    if "dist" not in scripts:
        scripts["dist"] = "electron-builder --win"
        dirty = True

    dev_deps = pkg.setdefault("devDependencies", {})
    if "electron-builder" not in dev_deps:
        dev_deps["electron-builder"] = "^26.18.0"
        dirty = True

    # Configure build settings
    build_cfg = pkg.setdefault("build", {})
    expected_build = {
        "appId": "com.mihrab.desktop",
        "productName": "Mihrab",
        "copyright": "Copyright © 2026 Mihrab Desktop",
        "directories": {
            "output": "dist"
        },
        "asar": True,
        "files": [
            "main.js",
            "preload.js",
            "package.json",
            "src/**/*",
            "themes/**/*",
            "data/**/*",
            "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
            "!**/node_modules/*/{test,__tests__,tests,powertests,example,examples}",
            "!**/*.map",
            "!build_app.py",
            "!test-engines.js",
            "!Project_Assets/**/*"
        ],
        "extraResources": [
            {
                "from": "themes",
                "to": "themes",
                "filter": ["**/*"]
            },
            {
                "from": "data",
                "to": "data",
                "filter": ["**/*"]
            }
        ],
        "win": {
            "target": ["portable", "nsis"],
            "icon": "src/ui/assets/app-icon.ico"
        },
        "nsis": {
            "oneClick": False,
            "allowToChangeInstallationDirectory": True,
            "createDesktopShortcut": True,
            "createStartMenuShortcut": True,
            "shortcutName": "Mihrab"
        },
        "portable": {
            "artifactName": "${productName}-Portable-${version}.${ext}"
        }
    }

    for k, v in expected_build.items():
        if k not in build_cfg:
            build_cfg[k] = v
            dirty = True

    if dirty:
        with open(PACKAGE_JSON, "w", encoding="utf-8") as f:
            json.dump(pkg, f, ensure_ascii=False, indent=2)
        log_success("Updated the package.json build configuration.")
    else:
        log_success("The package.json build configuration is already current.")

    # Ensure extra resource directories exist.
    extra_folders = [
        PROJECT_ROOT / "themes",
        PROJECT_ROOT / "data",
        PROJECT_ROOT / "src" / "ui" / "assets"
    ]
    for folder in extra_folders:
        if not folder.exists():
            folder.mkdir(parents=True, exist_ok=True)
            log_info(f"Created missing resource directory: {folder.relative_to(PROJECT_ROOT)}")

    # Check node_modules and electron-builder
    builder_mod = NODE_MODULES / "electron-builder"
    if not NODE_MODULES.exists() or not builder_mod.exists():
        log_warning("Build dependencies are missing; installing with npm install...")
        cmd = "npm.cmd install" if sys.platform == "win32" else "npm install"
        subprocess.run(cmd, shell=True, check=True, cwd=PROJECT_ROOT)
        log_success("Installed project and electron-builder dependencies.")
    else:
        log_success("node_modules and electron-builder are ready.")

    ensure_app_icons()

# =============================================================================
# 3. Run the build command (Run Electron-Builder)
# =============================================================================
def run_electron_builder(target="all", clean=False):
    if clean and DIST_DIR.exists():
        log_info("Cleaning previous dist/ outputs...")
        try:
            shutil.rmtree(DIST_DIR)
            log_success("Removed previous dist/ outputs.")
        except Exception as e:
            log_warning(f"Could not fully remove dist/ ({e})، continuing the build...")

    cmd_parts = ["npx.cmd" if sys.platform == "win32" else "npx", "electron-builder", "--win"]
    if target == "portable":
        cmd_parts.append("portable")
    elif target == "nsis":
        cmd_parts.append("nsis")

    builder_cmd = " ".join(cmd_parts)
    log_info(f"Running build command: {Colors.BOLD}{builder_cmd}{Colors.RESET}")
    print(f"{Colors.YELLOW}--- Begin build output (electron-builder) ---{Colors.RESET}")

    start_time = time.time()

    process = subprocess.Popen(
        builder_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=True,
        cwd=PROJECT_ROOT
    )

    for line in iter(process.stdout.readline, ''):
        print(f"  {Colors.CYAN}│{Colors.RESET} {line}", end="")

    process.stdout.close()
    return_code = process.wait()
    elapsed = time.time() - start_time

    print(f"{Colors.YELLOW}--- End build output ---{Colors.RESET}\n")

    if return_code != 0:
        log_error(f"Build failed (exit code: {return_code}).")
        sys.exit(return_code)

    return elapsed

# =============================================================================
# 4. Verify artifacts and optionally launch (Verify & Output)
# =============================================================================
def verify_output_and_prompt(elapsed_sec: float, auto_run: bool = False):
    log_header("Build verification and executable artifacts")

    if not DIST_DIR.exists():
        log_error("The command completed without creating dist/!")
        sys.exit(1)

    exe_files = list(DIST_DIR.glob("*.exe"))
    # Exclude temporary dumps and blockmaps.
    exe_files = [f for f in exe_files if not f.name.endswith(".blockmap")]

    if not exe_files:
        log_error("No .exe artifact was found in dist/!")
        sys.exit(1)

    # Sort artifacts by most recent modification time.
    exe_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    minutes = int(elapsed_sec // 60)
    seconds = int(elapsed_sec % 60)
    time_str = f"{minutes} minutes and {seconds} seconds" if minutes > 0 else f"{seconds} seconds"

    log_success(f"Build completed in: {Colors.BOLD}{time_str}{Colors.RESET}")
    print("\nExecutable artifacts ready for distribution:")

    preferred_exe = None
    for idx, exe in enumerate(exe_files, 1):
        size_mb = exe.stat().st_size / (1024 * 1024)
        is_portable = "portable" in exe.name.lower()
        badge = f"{Colors.GREEN}[Portable]{Colors.RESET}" if is_portable else f"{Colors.BLUE}[NSIS installer]{Colors.RESET}"
        
        print(f"  {Colors.BOLD}{idx}. {exe.name}{Colors.RESET} {badge}")
        print(f"     • Absolute path: {Colors.UNDERLINE}{exe.resolve()}{Colors.RESET}")
        print(f"     • File size:  {Colors.BOLD}{size_mb:.2f} MB{Colors.RESET}")

        if preferred_exe is None:
            preferred_exe = exe

    print(f"\n{Colors.BOLD}{Colors.GREEN}✨ Mihrab Windows packaging completed successfully!{Colors.RESET}\n")

    # Optional immediate launch
    should_run = auto_run
    if not should_run and sys.stdin.isatty():
        try:
            choice = input(f"{Colors.BOLD}{Colors.CYAN}Launch the generated application now? (y/N): {Colors.RESET}").strip().lower()
            should_run = choice in ['y', 'yes', 'نعم', '1']
        except (KeyboardInterrupt, EOFError):
            print()
            should_run = False

    if should_run and preferred_exe:
        log_info(f"Launching application: {preferred_exe.name}...")
        try:
            if sys.platform == "win32":
                os.startfile(str(preferred_exe.resolve()))
            else:
                subprocess.Popen([str(preferred_exe.resolve())], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            log_success("Application launched successfully.")
        except Exception as e:
            log_error(f"Could not launch the executable: {e}")

# =============================================================================
# CLI entry point (CLI Entry Point)
# =============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Mihrab build automation for Windows executable packages (.exe)",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "-t", "--target",
        choices=["all", "portable", "nsis"],
        default="all",
        help="Package target:\n"
             "  all      : Build both Portable and NSIS artifacts (default)\n"
             "  portable : Build only the portable artifact\n"
             "  nsis     : Build only the NSIS installer"
    )
    parser.add_argument(
        "-r", "--run",
        action="store_true",
        help="Launch the generated application after building without prompting"
    )
    parser.add_argument(
        "-c", "--clean",
        action="store_true",
        help="Clean dist/ before building"
    )

    args = parser.parse_args()

    print_banner()

    # 1. Stop stale processes
    cleanup_running_processes()

    # 2. Check dependencies
    check_and_prepare_dependencies()

    # 3. Run the build
    elapsed = run_electron_builder(target=args.target, clean=args.clean)

    # 4. Verify artifacts
    verify_output_and_prompt(elapsed, auto_run=args.run)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}[!] Build cancelled by the user.{Colors.RESET}")
        sys.exit(130)
