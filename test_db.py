import sys
sys.path.insert(0, r'C:\Users\BS.Harshan seliyan\Downloads\ledger-main\backend')
from database import SessionLocal
from models import Document
db = SessionLocal()
count = db.query(Document).count()
print('Document count', count)
docs = db.query(Document).all()
for d in docs:
    print(d.category, d.title)
db.close()
