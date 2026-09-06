/** Included in every dataset so materialized exports can be consumed without Snail. */
export const PYTHON_READER = String.raw`"""Snail dataset reader. IQ loading requires numpy; manifest listing uses only Python.

    python read_dataset.py /path/to/dataset
    from read_dataset import Dataset
    dataset = Dataset('/path/to/dataset')
    iq = dataset.read_iq(0)  # complex64, verifies the exported IQ checksum

Assign whole group_id values to train/validation/test before cropping or augmentation.
Unassigned events are not automatically a training set. Manifest-only exports contain
source coordinates and labels; read_iq requires a materialized IQ export.
"""
import hashlib
import json
from pathlib import Path


class Dataset:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        with (self.directory / 'manifest.json').open(encoding='utf-8') as stream:
            self.manifest = json.load(stream)
        if self.manifest.get('schemaVersion') != 1 or self.manifest.get('generator') != 'snail-dataset-1':
            raise ValueError('Unsupported Snail dataset schema')
        self.events = self.manifest['events']

    def __len__(self):
        return len(self.events)

    def read_iq(self, index, verify=True):
        import numpy as np
        record = self.events[index]
        artifact = record.get('iq')
        if artifact is None:
            raise ValueError('Manifest-only dataset: export with IQ to use read_iq')
        filename = (self.directory / artifact['path']).resolve()
        if self.directory not in filename.parents:
            raise ValueError('IQ path escapes the dataset directory')
        if artifact['datatype'] != 'cf32_le':
            raise ValueError('Unsupported IQ datatype')
        if filename.stat().st_size != artifact['sampleCount'] * 8:
            raise ValueError('IQ size does not match manifest')
        if verify:
            digest = hashlib.sha256()
            with filename.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            if digest.hexdigest() != artifact['sha256']:
                raise ValueError('IQ checksum mismatch')
        return np.memmap(filename, dtype='<c8', mode='r', shape=(artifact['sampleCount'],))

    def source_sample(self, event_index, output_sample):
        mapping = self.events[event_index]['sourceMapping']
        if not isinstance(output_sample, int) or not 0 <= output_sample < mapping['sampleCount']:
            raise ValueError('Sample index outside event')
        return mapping['startSample'] + output_sample * mapping['sampleStep']

    def group_id(self, index):
        return self.events[index]['groupId']


if __name__ == '__main__':
    import sys
    dataset = Dataset(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent)
    for index, record in enumerate(dataset.events):
        print(index, record['event']['label'], record['sourceMapping']['sampleCount'], record['split'], record['groupId'])
`
