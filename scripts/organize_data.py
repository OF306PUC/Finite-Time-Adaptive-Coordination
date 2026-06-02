"""
organize_data.py

Reads flat JSON files from raspberry/data/:
    {exp_name}_run{nn}-{network}.json

Produces in {out_dir}/{topology}/:
    config.json                        — node params (written once per topology)
    ble/{exp_name}_run{nn}-ble.csv     — time-series: timestamp, state, vstate, vartheta
    wifi/{exp_name}_run{nn}-wifi.csv
    bridge/{exp_name}_run{nn}-bridge.csv

Usage:
    python organize_data.py [--data-dir PATH] [--out-dir PATH] [--dry-run] [--delete]

    --delete   Remove source JSON files after successful CSV conversion.
"""

import argparse
import csv
import json
import re
from pathlib import Path

FILE_PATTERN = re.compile(r'^(.+)_run(\d+)-(\w+)\.json$')

CONFIG_PARAM_KEYS = [
    'node', 'type', 'ip', 'address', 'neighbors', 'neighborAddresses', 'neighborTypes',
    'clock', 'dt', 'eta', 'alpha', 'delta', 'consensual_avg_law',
    'state', 'vstate', 'vartheta', 'disturbance', 'enabled',
]


def organize(data_dir: Path, out_dir: Path, dry_run: bool = False, delete: bool = False):
    json_files = sorted(
        p for p in data_dir.iterdir()
        if p.is_file() and FILE_PATTERN.match(p.name)
    )

    if not json_files:
        print(f'No matching files found in {data_dir}')
        return

    written_configs: set[str] = set()

    for json_file in json_files:
        m        = FILE_PATTERN.match(json_file.name)
        exp_name = m.group(1)
        run_num  = m.group(2)
        network  = m.group(3)
        topology = exp_name.removeprefix('exp_')
        topo_dir = out_dir / topology
        dest_dir = topo_dir / network

        with json_file.open() as f:
            node_data = json.load(f)

        if not isinstance(node_data, dict):
            print(f'  WARNING: {json_file.name} — unexpected format, skipped')
            continue

        # Write config.json once per topology
        if topology not in written_configs:
            params = node_data.get('params', {})
            config = {
                'topology': topology,
                'params': {k: params[k] for k in CONFIG_PARAM_KEYS if k in params},
            }
            print(f'  config  →  {topology}/config.json')
            if not dry_run:
                topo_dir.mkdir(parents=True, exist_ok=True)
                with (topo_dir / 'config.json').open('w') as f:
                    json.dump(config, f, indent=2)
            written_configs.add(topology)

        # Write CSV
        d          = node_data.get('data', {})
        timestamps = d.get('timestamp', [])
        states     = d.get('state',     [None] * len(timestamps))
        vstates    = d.get('vstate',    [None] * len(timestamps))
        varthetas  = d.get('vartheta',  [None] * len(timestamps))

        out_name  = f'{exp_name}_run{run_num}-{network}.csv'
        dest_file = dest_dir / out_name
        print(f'  {json_file.name}  →  {topology}/{network}/{out_name}  ({len(timestamps)} rows)')

        if not dry_run:
            dest_dir.mkdir(parents=True, exist_ok=True)
            written = False
            try:
                with dest_file.open('w', newline='') as f:
                    writer = csv.writer(f)
                    writer.writerow(['timestamp', 'state', 'vstate', 'vartheta'])
                    writer.writerows(zip(timestamps, states, vstates, varthetas))
                written = True
            except Exception as e:
                print(f'  ERROR writing {dest_file}: {e}')

            if delete and written:
                json_file.unlink()
                print(f'  deleted  {json_file.name}')

    if dry_run:
        print('\n[dry-run] no files written')
    else:
        print('\nDone.')


if __name__ == '__main__':
    script_dir   = Path(__file__).parent
    default_data = script_dir.parent / 'raspberry' / 'data'
    default_out  = script_dir

    parser = argparse.ArgumentParser(description='Organize raspberry/data JSON files into {topology}/{network}/')
    parser.add_argument('--data-dir', type=Path, default=default_data)
    parser.add_argument('--out-dir',  type=Path, default=default_out)
    parser.add_argument('--dry-run',  action='store_true')
    parser.add_argument('--delete',   action='store_true',
                        help='Remove source JSON after successful CSV write')
    args = parser.parse_args()

    organize(args.data_dir, args.out_dir, args.dry_run, args.delete)
