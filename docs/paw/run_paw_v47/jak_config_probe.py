"""Read-only app-server config/read probe. No thread, turn or model request."""
import json
import queue
import subprocess
import sys
import threading
import time


def validate(config):
    if not isinstance(config, dict) or config.get('notify') != []:
        raise ValueError('notify')
    if config.get('hooks') not in (None, {}):
        raise ValueError('hooks')
    if config.get('mcp_servers') not in (None, {}):
        raise ValueError('mcp')
    for name in ('apps', 'plugins', 'remote_plugin', 'hooks', 'skill_mcp_dependency_install'):
        if config.get('features', {}).get(name) is not False:
            raise ValueError('features')


def main(argv):
    exe, cli, cwd, *overrides = argv
    proc = subprocess.Popen([exe, cli, *overrides, 'app-server', '--listen', 'stdio://'],
                            cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                            creationflags=0x08000000 if sys.platform == 'win32' else 0)
    messages = queue.Queue()

    def reader():
        try:
            for line in proc.stdout:
                messages.put(json.loads(line))
        except Exception:
            pass
        finally:
            messages.put(None)

    threading.Thread(target=reader, daemon=True).start()
    deadline = time.monotonic() + 40

    def send(value):
        proc.stdin.write(json.dumps(value) + '\n')
        proc.stdin.flush()

    def receive(ident):
        while True:
            value = messages.get(timeout=max(0.01, deadline-time.monotonic()))
            if value is None or time.monotonic() >= deadline:
                raise ValueError('unavailable')
            if value.get('id') == ident:
                if 'error' in value or 'result' not in value:
                    raise ValueError('rpc')
                return value['result']

    try:
        send({'id': 1, 'method': 'initialize', 'params': {
            'clientInfo': {'name': 'paw-jak-preflight', 'version': '4.6'},
            'capabilities': {'experimentalApi': True}}})
        receive(1)
        send({'method': 'initialized'})
        send({'id': 2, 'method': 'config/read', 'params': {'includeLayers': False, 'cwd': cwd}})
        validate(receive(2)['config'])
        print('JAK_CONFIG_OK')
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.terminate()
            proc.wait(timeout=3)
        proc.stdout.close()


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception:
        print('JAK_CONFIG_REFUZAT')
        sys.exit(3)
