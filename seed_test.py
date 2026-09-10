import sys
sys.path.insert(0, r'C:\Users\BS.Harshan seliyan\Downloads\ledger-main\backend')
from database import SessionLocal
from models import Document, Skill
import categorize
db = SessionLocal()
# create a dummy document
doc = Document(
    filename='test.txt',
    original_filename='Python Cert.txt',
    filepath='',
    file_ext='.txt',
    category='Certification',
    title='Python Certificate',
    extracted_text='This certifies Python and Machine Learning skills.',
    doc_date='2023',
    summary='[Certification] Test summary'
)
db.add(doc)
db.flush()
for skill_name in ['Python','Machine Learning']:
    skill = db.query(Skill).filter(Skill.name==skill_name).first()
    if not skill:
        skill = Skill(name=skill_name)
        db.add(skill)
        db.flush()
    doc.skills.append(skill)
db.commit()
print('Seeded')
db.close()
