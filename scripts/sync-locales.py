"""Generate reviewable UI catalog changes from ar.json. Never reads Quran data."""
from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlencode
import json
import re
import sys
import subprocess

LANGUAGES = ('en', 'id', 'ur', 'bn', 'fr', 'tr')
PLACEHOLDER = re.compile(r'\{\w+\}')
SENSITIVE = re.compile(
    r'https?://|www\.|@|\b(?:IBAN|RIB|SWIFT|PayPal|bank|account|token|password|secret)\b|'
    r'\d{6,}|الحساب|حسابك|حسابه|الحسابات|بنكي|بنكية|البنك|مصرف|المستفيد|البطاقة|الدفع|التحويل|'
    r'التبرع|الدعم المالي|البريد|كلمة المرور|بيانات شخصية|رقم الهاتف|رمز الربط', re.I
)
PROTECTED = ('surah.name.', 'tajweed.transliteration.')
SEPARATOR = 'ZXQSEPZXQ'

class RateLimited(Exception):
    pass

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.is_file() else {}

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)

def fingerprint(value):
    return sha256(value.encode('utf-8')).hexdigest()

def valid(source, target):
    return (isinstance(target, str) and bool(target.strip())
            and sorted(PLACEHOLDER.findall(source)) == sorted(PLACEHOLDER.findall(target))
            and 'ZXQ' not in target)

def batches(entries):
    batch = []
    size = 0
    for key, value in entries:
        if batch and size + len(value) > 1000:
            yield batch
            batch, size = [], 0
        batch.append((key, value))
        size += len(value) + len(SEPARATOR) + 2
    if batch:
        yield batch

def translate(batch, lang):
    payload = ('\n' + SEPARATOR + '\n').join(
        PLACEHOLDER.sub(lambda m: 'ZXQVAR' + m[0][1:-1] + 'ZXQ', text) for _, text in batch
    )
    url = 'https://translate.googleapis.com/translate_a/single?' + urlencode(
        {'client': 'gtx', 'sl': 'ar', 'tl': lang, 'dt': 't', 'q': payload}
    )
    for _ in range(2):
        try:
            raw = subprocess.check_output(['curl', '-fsS', '--max-time', '20', url], stderr=subprocess.PIPE)
            chunks = ''.join(row[0] or '' for row in json.loads(raw)[0]).split(SEPARATOR)
            if len(chunks) != len(batch):
                continue
            translated = {}
            for (key, source), text in zip(batch, chunks):
                text = re.sub(r'ZXQVAR\s*(\w+?)\s*ZXQ', r'{\1}', text.strip(), flags=re.I)
                if valid(source, text):
                    translated[key] = text
            return translated
        except subprocess.CalledProcessError as error:
            if b'429' in (error.stderr or b''):
                raise RateLimited('Translation provider rate limit reached. Resume later.') from error
        except (ValueError, TypeError, subprocess.SubprocessError):
            continue
    if len(batch) > 1:
        midpoint = len(batch) // 2
        return translate(batch[:midpoint], lang) | translate(batch[midpoint:], lang)
    return {}

def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check', 'draft', 'apply'))
    parser.add_argument('--lang', choices=LANGUAGES, action='append')
    parser.add_argument('--draft-file', type=Path, default=Path('locale-review.json'))
    args = parser.parse_args()
    folder = Path(__file__).resolve().parents[1] / 'src/ui/locales'
    source = read(folder / 'ar.json')
    if not source:
        raise SystemExit('Empty Arabic catalog')
    hashes = {key: fingerprint(value) for key, value in source.items()}
    state_file = Path(__file__).with_name('locale-source-revisions.json')
    revisions = read(state_file)
    drafts = read(args.draft_file)
    has_pending = False
    prepared = {}
    for lang in args.lang or LANGUAGES:
        current = read(folder / f'{lang}.json')
        old = revisions.get(lang, {})
        changes = {key: value for key, value in source.items()
                   if old.get(key) != hashes[key] or not valid(value, current.get(key))}
        removed = sorted(current.keys() - source.keys())
        print(f'{lang}: {len(changes)} new/changed, {len(removed)} removed')
        has_pending |= bool(changes or removed)
        if args.action == 'check':
            for key in changes:
                print(f'  + {key}')
            for key in removed:
                print(f'  - {key}')
            continue
        review = drafts.setdefault(lang, {})
        if args.action == 'draft':
            pending = [(k, v) for k, v in changes.items()
                       if not k.startswith(PROTECTED) and not SENSITIVE.search(v)
                       and (review.get(k, {}).get('sourceSha256') != hashes[k]
                            or not valid(v, review.get(k, {}).get('translation')))]
            result = {}
            limited = None
            with ThreadPoolExecutor(max_workers=6) as pool:
                jobs = [pool.submit(translate, batch, lang) for batch in batches(pending)]
                for job in jobs:
                    try:
                        result.update(job.result())
                    except RateLimited as error:
                        limited = error
                        for queued in jobs:
                            queued.cancel()
                        break
            for key, text in changes.items():
                entry = review.get(key, {})
                if entry.get('sourceSha256') != hashes[key] or key in result:
                    review[key] = {'sourceSha256': hashes[key], 'source': text,
                                   'translation': result.get(key, '')}
                if not review[key]['translation']:
                    print(f'  Review manually: {key}')
                elif len(text) <= 35 and len(review[key]['translation']) > 45:
                    print(f'  Check label length: {key}')
            write(args.draft_file, drafts)
            if limited:
                raise SystemExit(str(limited))
        else:
            for key, source_text in changes.items():
                entry = review.get(key, {})
                if entry.get('sourceSha256') != hashes[key] or not valid(source_text, entry.get('translation')):
                    raise SystemExit(f'Missing, stale or invalid review for {lang}:{key}')
                current[key] = entry['translation']
            prepared[lang] = {key: current[key] for key in source}
    if args.action == 'draft':
        write(args.draft_file, drafts)
        print(f'Review and shorten UI labels in {args.draft_file} before applying.')
    if args.action == 'apply':
        for lang, catalog in prepared.items():
            write(folder / f'{lang}.json', catalog)
            revisions[lang] = hashes
        write(state_file, revisions)
    if args.action == 'check' and has_pending:
        print('[Mihrab locales] FAILED: resolve the pending keys listed above before building. '
              'Send the Arabic changes through the translation bot, then rerun locales:check.', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
