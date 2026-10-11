#!/usr/bin/env python3
"""Copy exact, read-only remote storage at the fork block into a local Anvil cache."""
import json,sys,urllib.request,concurrent.futures,time,threading
rate_lock=threading.Lock()
next_read=0.0
local,remote,access_file=sys.argv[1:]
def rpc(url,body):
 data=json.dumps(body).encode()
 for attempt in range(4):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,data=data,headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0'}),timeout=30) as r: return json.load(r)
  except Exception:
   if attempt==3:raise
   time.sleep(.5)
block=rpc(local,{'jsonrpc':'2.0','id':1,'method':'eth_getBlockByNumber','params':['latest',False]})['result']['number']
entries=json.load(open(access_file))['accessList']
slots=[(e['address'],s) for e in entries for s in e['storageKeys']]
def fetch(batch):
 global next_read
 with rate_lock:
  delay=max(0,next_read-time.monotonic())
  if delay:time.sleep(delay)
  next_read=time.monotonic()+len(batch)/16
 result=[]
 for a,slot in batch:
  out=rpc(remote,{'jsonrpc':'2.0','id':1,'method':'eth_getStorageAt','params':[a,slot,block]})
  if 'error' in out:raise RuntimeError(out['error'])
  result.append((a,slot,out['result']))
 return result
batches=[slots[i:i+1] for i in range(0,len(slots),1)]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex: values=[v for group in ex.map(fetch,batches) for v in group]
for i in range(0,len(values),100):
 req=[{'jsonrpc':'2.0','id':j,'method':'anvil_setStorageAt','params':[a,s,v]} for j,(a,s,v) in enumerate(values[i:i+100])]
 out=rpc(local,req)
 assert all('error' not in x for x in out),out
print(f'Prewarmed {len(values)} exact storage slots at fork block {block}')
