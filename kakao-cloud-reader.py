"""Read only the four authorized chats; all collection cursors come from Supabase."""
import json
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

ROOMS = [('LS Production 1', '453981707667079'), ('SMT', '461913194057523'),
         ('NEXLIDE MQ', '473535309242980')]
DM = '481868546664117'


def read_messages(reader, bounds):
    allowed = [room[1] for room in ROOMS] + [DM]
    if set(bounds) != set(allowed) or any(not isinstance(bounds[cid], str) or
            not re.fullmatch(r'\d{1,30}', bounds[cid]) for cid in allowed):
        raise ValueError('Invalid cloud checkpoints')
    for name, cid in ROOMS:
        matches = reader._query("SELECT DISTINCT chatId FROM NTChatMeta WHERE type=3 AND lower(trim(content))=lower('" + name + "')")
        if len(matches) != 1 or str(matches[0][0]) != cid:
            raise ValueError('Room identity mismatch')
    authors = {str(v[0]) for v in reader._query('SELECT DISTINCT authorId FROM NTChatMessage WHERE chatId=' + DM + ' AND authorId IS NOT NULL AND authorId!=0')}
    if authors != {'3389141', '55304262'}:
        raise ValueError('DM identity mismatch')
    messages = []
    for name, cid in ROOMS + [('이노텍 이정호 개발팀 1:1', DM)]:
        rows = reader._query('SELECT m.logId,m.authorId,COALESCE(u.displayName,\'(unknown)\'),m.sentAt,m.type,m.message FROM NTChatMessage m LEFT JOIN NTUser u ON m.authorId=u.userId WHERE m.chatId=' + cid + ' AND m.logId>' + bounds[cid] + " AND m.message IS NOT NULL AND m.message!='' ORDER BY m.logId")
        for row in rows:
            messages.append({'room': name, 'chatId': cid, 'logId': str(row[0]),
                'authorId': str(row[1]), 'sender': row[2], 'senderNameCandidates': [row[2]],
                'time': datetime.fromtimestamp(row[3], ZoneInfo('America/Mexico_City')).isoformat(),
                'type': row[4], 'text': row[5]})
    return {'dmVerified': True, 'messages': messages}


if __name__ == '__main__':
    try:
        os.environ.setdefault('KAKAOCLI_BIN', '/opt/homebrew/bin/kakaocli')
        from kakaotalk_mcp.reader import KakaoReader
        print(json.dumps(read_messages(KakaoReader(), json.load(sys.stdin)), ensure_ascii=False))
    except Exception:
        sys.exit('Authorized Kakao read failed; sensitive diagnostics suppressed')
