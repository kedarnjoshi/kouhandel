# The network's win chances for the first rows of a data file, for checking lib/bots/value.js against PyTorch:
#   python agent/value/predict.py <net.json> <data.bin> [rows]   (prints json: [[p0, p1, p2], ...])
import json, sys
import numpy as np
import torch
import train
j = json.load(open(sys.argv[1])); train.ARCH = j.get('arch', 'a')
a = train.load([sys.argv[2]])[:int(sys.argv[3]) if len(sys.argv) > 3 else 50]
ft, fp, alive, wins, seed, who = train.features(a)
net = train.Net(j['ft'], j['fp']); net.load_state_dict({k: torch.tensor(v) for k, v in j['weights'].items()}); net.double()
with torch.no_grad(): p = torch.softmax(net(torch.tensor(ft).double(), torch.tensor(fp).double(), torch.tensor(alive).double()), -1)
print(json.dumps(p.numpy().tolist()))
