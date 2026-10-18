const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('legacy hosting forwards project route and editor query without loading the old database client',()=>{
 const file=require('node:path').join(__dirname,'legacy-site/index.html');a.equal(fs.existsSync(file),true);const html=fs.readFileSync(file,'utf8');let target;vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{URL,location:{search:'?edit=1',hash:'#/projects/example',replace:value=>{target=value;}}});a.equal(target,'https://louiscxcix.github.io/lspm/?edit=1#/projects/example');a.doesNotMatch(html,/cloud-api\.js|firebase-store|firestore|public-workspace/);const config=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'firebase-legacy.json')));a.equal(config.hosting.site,'louis-lgls-pm');a.equal(config.firestore,undefined);
});
test('desktop launcher opens the cloud application rather than starting a local database',()=>{
 const launcher=fs.readFileSync(require('node:path').join(__dirname,'start-local.command'),'utf8');a.match(launcher,/open https:\/\/louiscxcix\.github\.io\/lspm\//);a.doesNotMatch(launcher,/server\.js|127\.0\.0\.1|\.local-data/);
});
