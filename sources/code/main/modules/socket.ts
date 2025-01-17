import { Server, WebSocket } from "ws";

async function wsLog(message:string, ...args:unknown[]) {
    const colors = (await import("@spacingbat3/kolor")).default;
    console.log(colors.bold(colors.brightMagenta("[WebSocket]"))+" "+message,...args);
}

function range(start:number,end:number) {
    return Array.from({length:end-start+1}, (_v,k) => start+k);
}

interface InviteResponse {
    /** Response type/command. */
    cmd: "INVITE_BROWSER",
    /** Response arguments. */
    args:{
        /** An invitation code. */
        code: string
    },
    /** Nonce indentifying the communication. */
    nonce: string;
}

function isInviteResponse(data:unknown): data is InviteResponse {
    if(!(data instanceof Object))
        return false;
    if(typeof (data as InviteResponse).cmd !== 'string')
        return false;
    if(typeof (data as InviteResponse).args.code !== 'string')
        return false;
    if(typeof (data as InviteResponse).cmd !== 'string')
        return false;
    return true;
}

const messages = {
    handShake: {
        cmd:"DISPATCH",
        data:{
            v: 1,
            config:{
                cdn_host: "cdn.discordapp.com",
                api_endpoint: "//discord.com/api",
                environment: "production"
            }
        },
        evt: "READY",
        nonce: null
    }
}

async function getServer(port:number) {
    const {WebSocketServer} = await import("ws");
    return new Promise<Server<WebSocket>|null>(resolve => {
        const wss = new WebSocketServer({ host: '127.0.0.1', port });
        wss.once('listening', () => resolve(wss));
        wss.once('error', () => resolve(null));
    }) 
}

export default async function startServer(window:Electron.BrowserWindow) {
    const [
        {isJsonSyntaxCorrect, knownIstancesList},
        {initWindow},
        {underscore},
        L10N
    ] = await Promise.all([
        import("../../global/global"),
        import("./parent"),
        import("@spacingbat3/kolor").then(kolor => kolor.default),
        import("../../global/modules/l10n").then(l10n => l10n.default)
    ]);
    const {listenPort} = new L10N().client.log;
    let wss = null, wsPort = 6463;
    for(const port of range(6463, 6472)) {
        wss = await getServer(port);
        if(wss !== null) {
            void wsLog(listenPort,underscore(port.toString()));
            wsPort = port;
            break;
        }
    }
    if(wss === null) return;
    let lock = false;
    wss.on('connection', (wss, request) => {
        const origin = request.headers.origin??'https://discord.com';
        let known = false;
        for(const instance in knownIstancesList) {
            if(knownIstancesList[instance][1].origin === origin)
                known = true;
        }
        if(!known) return;
        wss.send(JSON.stringify(messages.handShake));
        wss.once('message', (data, isBinary) => {
            if(lock) return;
            lock = true;
            let parsedData:unknown = data;
            if(!isBinary)
                parsedData = data.toString();
            if(isJsonSyntaxCorrect(parsedData as string))
                parsedData = JSON.parse(parsedData as string);
            if(isInviteResponse(parsedData)) {
                /* Replies to browser, so it finds communication successful. */
                wss.send(JSON.stringify({
                    cmd: parsedData.cmd,
                    data: {
                        invite: null,
                        code: parsedData.args.code
                    },
                    evt: null,
                    nonce: parsedData.nonce
                }));
                const child = initWindow("invite", window);
                if(child === undefined) return;
                void child.loadURL(origin+'/invite/'+parsedData.args.code);
                child.webContents.once("did-finish-load", () => {
                    child.show();
                });
                child.webContents.once("will-navigate", () => {
                    lock = false;
                    child.close();
                })
                /* Blocks requests to WebCord's WS, to prevent loops. */
                child.webContents.session.webRequest.onBeforeRequest({
                    urls: ['ws://127.0.0.1:'+wsPort.toString()+'/*']
                }, (_details,callback) => callback({cancel: true}));
            }
        })
    })
}