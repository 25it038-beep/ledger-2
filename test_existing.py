import sys
sys.path.insert(0, r'C:\Users\BS.Harshan seliyan\Downloads\ledger-main\backend')
from fastapi.testclient import TestClient
import main
client = TestClient(main.app)
r = client.get('/api/documents')
print('documents status', r.status_code, len(r.json()))
r2 = client.get('/api/search?q=Python')
print('search status', r2.status_code, len(r2.json()))
r3 = client.get('/api/timeline')
print('timeline status', r3.status_code)
r4 = client.get('/api/graph')
print('graph status', r4.status_code)
