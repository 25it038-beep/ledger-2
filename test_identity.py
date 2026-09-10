import sys
sys.path.insert(0, r'C:\Users\BS.Harshan seliyan\Downloads\ledger-main\backend')
from fastapi.testclient import TestClient
import main
client = TestClient(main.app)
r = client.get('/api/identity')
print('Status', r.status_code)
data = r.json()
print('Keys', list(data.keys()))
print('Summary', data.get('summary')[:200])
print('Statistics', data.get('statistics'))
print('Skills count', len(data.get('skills', [])))
