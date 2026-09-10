import sys
sys.path.insert(0, r'C:\Users\BS.Harshan seliyan\Downloads\ledger-main\backend')
from fastapi.testclient import TestClient
import main
client = TestClient(main.app)
r = client.get('/api/dashboard')
print('Status', r.status_code)
data = r.json()
print('Keys', list(data.keys()))
print('Stats', data.get('stats'))
print('Identity', data.get('identity'))
