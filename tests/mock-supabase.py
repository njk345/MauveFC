"""Local contract-test service only. Not an authentication implementation or deployable backend."""
import base64,json,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
C='11111111-1111-4111-8111-111111111111';S='66666666-6666-4666-8666-666666666666';P='77777777-7777-4777-8777-777777777777';M='88888888-8888-4888-8888-888888888888'
snapshot={'seasons':[{'id':S,'name':'Fall 2026','competition':'Test league','format':'7v7'}],'players':[{'id':P,'name':'Test Captain','number':9,'position':'Forward','initials':'TC','hometown':'Brooklyn','bio':'Contract test player'}],'roster':[{'seasonId':S,'playerId':P}],'matches':[{'id':M,'seasonId':S,'opponent':'Test Opposition','opponentCode':'TO','color':'#657293','kickoff':'2026-11-13T00:00:00Z','venue':'Test pitch','round':1,'home':True,'status':'scheduled','revision':0}]}
def user(email):return {'id':'33333333-3333-4333-8333-333333333333' if email=='captain@example.com' else '55555555-5555-4555-8555-555555555555','aud':'authenticated','role':'authenticated','email':email,'app_metadata':{},'user_metadata':{},'created_at':'2026-11-09T00:00:00Z'}
def token(email):
 encode=lambda obj:base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
 return encode({'alg':'HS256','typ':'JWT'})+'.'+encode({'sub':user(email)['id'],'email':email,'exp':int(time.time())+3600,'aud':'authenticated','role':'authenticated'})+'.contract-test-signature'
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def send(self,status,data):
  body=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Access-Control-Allow-Origin','http://localhost:3001');self.send_header('Access-Control-Allow-Headers',self.headers.get('Access-Control-Request-Headers','authorization,apikey,x-client-info,content-type,content-profile,accept-profile,prefer'));self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_OPTIONS(self):self.send(200,{})
 def identity(self):
  try:
   payload=self.headers['Authorization'].split(' ')[1].split('.')[1];return json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))['email']
  except:return None
 def do_GET(self):
  email=self.identity()
  if self.path.startswith('/auth/v1/user'):self.send(200,user(email)) if email else self.send(401,{'message':'No session'})
  elif self.path.startswith('/rest/v1/club_memberships'):self.send(200,[{'role':'captain' if email=='captain@example.com' else 'player'}])
  elif self.path.startswith('/rest/v1/match_drafts'):self.send(200,[])
  else:self.send(404,{})
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or '{}');email=self.identity()
  if self.path.startswith('/auth/v1/otp'):
   assert body.get('create_user') is False;self.send(200,{})
  elif self.path.startswith('/auth/v1/verify'):
   if body.get('token')!='123456':self.send(403,{'code':'otp_expired','msg':'Invalid test code'});return
   email=body['email'];self.send(200,{'access_token':token(email),'token_type':'bearer','expires_in':3600,'expires_at':int(time.time())+3600,'refresh_token':'contract-test-refresh','user':user(email)})
  elif self.path.startswith('/auth/v1/logout'):self.send(200,{})
  elif self.path.endswith('/get_public_club'):self.send(200,snapshot)
  elif self.path.endswith('/get_captain_club'):
   self.send(200,snapshot) if email=='captain@example.com' else self.send(403,{'code':'42501','message':'Captain required'})
  elif self.path.endswith('/save_match_result'):self.send(409,{'code':'40001','message':'Match changed in another session'})
  else:self.send(403,{'code':'42501','message':'Forbidden'})
ThreadingHTTPServer(('127.0.0.1',54329),Handler).serve_forever()
