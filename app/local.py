"""Run the game on this computer: python app/local.py

Copies the current code (app/, lib/, public/) to a snapshot folder outside the repo, builds it and serves it on
port 3000 (or the next free one), reachable from other devices on the same network. Edits to the repo while it
runs do not affect the game; run it again to pick them up. Rooms live in memory, so no Redis is needed and nothing
is sent to the online database. The server logs every game to its games/ folder, which here is the repo's
games/ (see agent/README.md): node agent/scripts/replay.mjs games/<file>.json

Options:
  --port N   serve on port N (default: 3000, or the next free port)
  --keep     serve the last snapshot again without copying or building (the same bots as last time)
  --live     run the dev server straight from the repo instead (reloads on every edit)
"""
import argparse
import os
import shutil
import socket
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPSHOT = os.path.join(tempfile.gettempdir(), 'koehandel-local')
COPY = ['app', 'lib', 'public', 'package.json', 'package-lock.json']
WIN = os.name == 'nt'


def lan_ip():
    # Connecting a UDP socket sends nothing; it only makes the OS pick the network interface it would use.
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def free_port(start):
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    sys.exit(f'No free port between {start} and {start + 49}')


def snapshot():
    os.makedirs(SNAPSHOT, exist_ok=True)
    for name in COPY:
        src, dst = os.path.join(REPO, name), os.path.join(SNAPSHOT, name)
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        elif os.path.exists(dst):
            os.remove(dst)
        if os.path.isdir(src):
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns('local.py', '__pycache__'))
        elif os.path.exists(src):
            shutil.copy2(src, dst)
    share()


def share():
    # shared with the repo: the packages, and the game logs the server writes
    os.makedirs(os.path.join(REPO, 'games'), exist_ok=True)
    for name in ('node_modules', 'games'):
        link, target = os.path.join(SNAPSHOT, name), os.path.join(REPO, name)
        if os.path.exists(link):
            continue
        if WIN:  # a junction needs no admin rights, unlike a symlink
            subprocess.run(['cmd', '/c', 'mklink', '/J', link, target], check=True, stdout=subprocess.DEVNULL)
        else:
            os.symlink(target, link)


def main():
    ap = argparse.ArgumentParser(description='Run Koehandel locally.')
    ap.add_argument('--port', type=int)
    ap.add_argument('--keep', action='store_true')
    ap.add_argument('--live', action='store_true')
    args = ap.parse_args()

    if not os.path.isdir(os.path.join(REPO, 'node_modules')):
        sys.exit('Run "npm install" in the repo first.')
    port = args.port or free_port(3000)
    env = {k: v for k, v in os.environ.items() if 'REDIS' not in k and not k.startswith('KV_')}
    next_bin = os.path.join(REPO, 'node_modules', '.bin', 'next.cmd' if WIN else 'next')

    if args.live:
        cwd, cmd = REPO, [next_bin, 'dev', '-H', '0.0.0.0', '-p', str(port)]
    elif args.keep and os.path.isdir(os.path.join(SNAPSHOT, '.next')):
        share()
        cwd, cmd = SNAPSHOT, [next_bin, 'start', '-H', '0.0.0.0', '-p', str(port)]
    else:
        print(f'Copying the code to {SNAPSHOT} and building (about a minute)...', flush=True)
        snapshot()
        for f in os.listdir(SNAPSHOT):  # keep the online database out of local games
            if f.startswith('.env'):
                os.remove(os.path.join(SNAPSHOT, f))
        subprocess.run([next_bin, 'build'], cwd=SNAPSHOT, env=env, check=True)
        cwd, cmd = SNAPSHOT, [next_bin, 'start', '-H', '0.0.0.0', '-p', str(port)]

    ip = lan_ip()
    print()
    print(f'  On this computer:   http://localhost:{port}')
    print(f'  On your network:    http://{ip}:{port}')
    print('  Stop with Ctrl+C. (Windows may ask to allow Node through the firewall for the network address.)')
    print(flush=True)
    try:
        subprocess.run(cmd, cwd=cwd, env=env)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
