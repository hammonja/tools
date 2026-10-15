const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/pwa.js'),'utf8');
function setup({ua='',platform='',touch=0,mobile,standalone=false,iosStandalone=false,secure=true}={}) {
 const handlers={}; const docHandlers={}; const button={hidden:true,addEventListener:(name,fn)=>{button[name]=fn;}};
 const media={matches:standalone,addEventListener:(_name,fn)=>{media.change=fn;}};
 const window={isSecureContext:secure,matchMedia:()=>media,addEventListener:(name,fn)=>{handlers[name]=fn;},dispatchEvent:()=>{}};
 const navigator={userAgent:ua,platform,maxTouchPoints:touch,standalone:iosStandalone,userAgentData:mobile===undefined?undefined:{mobile}};
 const document={getElementById:()=>button,addEventListener:(name,fn)=>{docHandlers[name]=fn;}};
 vm.runInNewContext(source,{window,navigator,document,Event,URL,setTimeout,clearTimeout,alert:()=>{}});
 return {button,handlers,media,navigator};
}
for(const [name,options,visible] of [
 ['Android Chrome',{ua:'Mozilla/5.0 Android Chrome',mobile:true},true],
 ['Android Edge',{ua:'Mozilla/5.0 Android EdgA'},true],
 ['Android Firefox',{ua:'Mozilla/5.0 Android Firefox'},true],
 ['iPhone Safari',{ua:'Mozilla/5.0 iPhone Safari'},true],
 ['iPhone Chrome',{ua:'Mozilla/5.0 iPhone CriOS'},true],
 ['iPhone Firefox',{ua:'Mozilla/5.0 iPhone FxiOS'},true],
 ['iPad desktop identity',{ua:'Mozilla/5.0 Macintosh',platform:'MacIntel',touch:5},true],
 ['touch laptop',{ua:'Mozilla/5.0 Windows Chrome',touch:10,mobile:false},false],
 ['desktop Firefox',{ua:'Mozilla/5.0 Windows Firefox'},false],
 ['desktop Safari',{ua:'Mozilla/5.0 Macintosh Safari',platform:'MacIntel'},false],
 ['insecure mobile',{ua:'Android',secure:false},false],
 ['Android installed',{ua:'Android',standalone:true},false],
 ['iOS installed',{ua:'iPhone',iosStandalone:true},false]
]) test(`install visibility: ${name}`,()=>assert.equal(setup(options).button.hidden,!visible));

test('install dismissal keeps fallback; acceptance and standalone transitions hide the control',async()=>{
 const env=setup({ua:'Android'});
 env.handlers.beforeinstallprompt({preventDefault(){},prompt:async()=>{},userChoice:Promise.resolve({outcome:'dismissed'})});
 await env.button.click(); assert.equal(env.button.hidden,false);
 env.media.matches=true;env.media.change();assert.equal(env.button.hidden,true);
 env.media.matches=false;env.media.change();assert.equal(env.button.hidden,false);
 env.handlers.beforeinstallprompt({preventDefault(){},prompt:async()=>{},userChoice:Promise.resolve({outcome:'accepted'})});
 await env.button.click();assert.equal(env.button.hidden,true);
 env.handlers.pageshow();assert.equal(env.button.hidden,true);
});
