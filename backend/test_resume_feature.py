"""
End-to-End Verification Test for the Resume Creator Feature
"""
from starlette.testclient import TestClient
import main
import json

client = TestClient(main.app)

def test_resume_feature():
    # 1. Test resume data endpoint
    r = client.get('/api/resume/data')
    assert r.status_code == 200, f'resume/data failed: {r.status_code}'
    data = r.json()
    print('Candidate Name:', data['resume']['personal']['name'])
    print('Extracted Skills categories:', list(data['resume']['skills'].keys()))
    print('Extracted Projects count:', len(data['resume']['projects']))
    print('ATS Score:', data['analysis']['ats_score'])
    assert len(data['templates']) == 5, 'Must provide 5 templates'
    assert len(data['target_modes']) == 8, 'Must provide 8 target modes'

    # 2. Test PDF generation for all 5 templates
    for tpl in data['templates']:
        tpl_id = tpl['id']
        copy_data = dict(data['resume'])
        copy_data['template'] = tpl_id
        gen_r = client.post('/api/resume/generate', json={'resume_data': copy_data})
        assert gen_r.status_code == 200, f'generate failed for {tpl_id}: {gen_r.status_code}'
        assert gen_r.headers['content-type'] == 'application/pdf', 'Must return application/pdf'
        assert len(gen_r.content) > 1000, 'PDF size must be > 1000 bytes'
        print(f'PDF Template: {tpl_id:<22} -> Size: {len(gen_r.content)} bytes [PASS]')

    # 3. Test saving resume draft
    save_r = client.post('/api/resume/save', json={
        'target': 'AI / ML',
        'template': 'modern_developer',
        'resume_data': data['resume']
    })
    assert save_r.status_code == 200, f'save failed: {save_r.status_code}'
    assert save_r.json()['saved'] is True
    print('Resume Save Draft: [PASS]')

    # 4. Test preview endpoint
    preview_r = client.post('/api/resume/preview', json={'resume_data': data['resume']})
    assert preview_r.status_code == 200, f'preview failed: {preview_r.status_code}'
    assert 'analysis' in preview_r.json()
    print('Resume Preview & Analysis: [PASS]')

    # 5. Test Copilot Resume Prompts
    prompts = [
        'Create my resume.',
        'Create an AI/ML resume from my profile.',
        'Which skills should I highlight?',
        'Improve my project description.',
        'Make this resume internship-ready.',
        'Which projects are strongest for a backend role?',
        'Create a cybersecurity-focused resume.'
    ]
    for q in prompts:
        cop_r = client.post('/api/career/copilot', data={'question': q})
        assert cop_r.status_code == 200, f'copilot failed for "{q}": {cop_r.status_code}'
        ans = cop_r.json().get('answer', '')
        assert len(ans) > 20, f'Answer too short for "{q}"'
        print(f'Copilot Prompt: "{q}" -> Response length: {len(ans)} chars [PASS]')

    # 6. Verify existing platform endpoints
    endpoints = [
        '/api/documents',
        '/api/skills',
        '/api/categories',
        '/api/timeline',
        '/api/graph',
        '/api/career/profile',
        '/api/news',
        '/api/hackathons',
        '/api/dashboard',
        '/api/identity'
    ]
    for ep in endpoints:
        res = client.get(ep)
        assert res.status_code in [200, 404], f'Existing endpoint {ep} failed: {res.status_code}'
        print(f'Existing Endpoint {ep:<25} -> Status: {res.status_code} [PASS]')

    print('\n=========================================')
    print('ALL AUTOMATED TESTS PASSED SUCCESSFULLY!')
    print('=========================================')

if __name__ == '__main__':
    test_resume_feature()
