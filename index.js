const {hSet,hGetAll,hDel}  = require('./redis')
const {getMsg,getParams} = require('./common')

var fs=require('fs');  
const { log } = require('console');
const https = require('https');
const http = require('http')
var express = require('express');
var app = express();

const options = {
    key: fs.readFileSync('./key.pem'),
    cert: fs.readFileSync('./cert.pem')
};

//http server
// app.use(express.static('./dist'));
// app.use(function (req, res,next) {
//   res.sendfile('./dist/index.html');  //路径根据自己文件配置
// });  
var server=https.createServer(options,app)
//socket server
let io = require('socket.io')(server,{allowEIO3:true});

//自定义命令空间  nginx代理 /mediaServerWsUrl { http://xxxx:18080/socket.io/ }
// io = io.of('mediaServerWsUrl')

server.listen(18080, async() => {
  console.log('服务器启动成功 *:18080');
});


io.on('connection', async (socket) => {
	await onListener(socket)
});



const userMap = new Map() // user - > socket
const roomKey = "meeting-room::"


/**
 * DB data
 * @author 
 * @param {Object} userId
 * @param {Object} roomId
 * @param {Object} nickname
 * @param {Object} pub
 */
async function getUserDetalByUid(userId,roomId,nickname,pub){
	let res = JSON.stringify(({"userId":userId,"roomId":roomId,"nickname":nickname,"pub":pub}))
	return res
}

/**
 * 监听
 * @param {Object} s
 */
async function onListener(s){
	let url = s.client.request.url
	let userId = getParams(url,'userId')
	let roomId = getParams(url,'roomId')
	let nickname = getParams(url,'nickname')
	let pub = getParams(url,'pub')
	console.log("client uid："+userId+" roomId: "+roomId+" 【"+nickname+"】online ")
	//user map
	userMap.set(userId,s)
	//room cache
	if(roomId){
		await hSet(roomKey+roomId,userId, await getUserDetalByUid(userId,roomId,nickname,pub))
		console.log("roomId",roomId)
		oneToRoomMany(roomId,getMsg('join',userId+ ' join then room',200,{userId:userId,nickname:nickname}))
	}
	
	s.on('msg', async (data) => {
		  console.log("msg",data)
		  await oneToRoomMany(roomId,data)
	});
	
	s.on('disconnect', () => { 
		  console.log("client uid："+userId+" roomId: "+roomId+" 【"+nickname+"】 offline ")
		  userMap.delete(userId)
		  if(roomId){
			  hDel(roomKey+roomId,userId)
			  oneToRoomMany(roomId,getMsg('leave',userId+' leave the room ',200,{userId:userId,nickname:nickname}))
		  }
	});	
	
	s.on('roomUserList', async (data) => {
		// console.log("roomUserList msg",data)
		s.emit('roomUserList',await getRoomOnlyUserList(data['roomId']))
	})
	s.on('call',(data) => {
		let targetUid = data['targetUid']
		if(userMap.get(targetUid)){
			oneToOne(targetUid,getMsg('call',"远程呼叫",200,data))
		}else{
			console.log(targetUid+ "不在线")
		}
	})
	s.on('candidate',(data) => {
		let targetUid = data['targetUid']
		if(userMap.get(targetUid)){
			oneToOne(targetUid,getMsg('candidate',"ice candidate",200,data))
		}else{
			console.log(targetUid+ "不在线")
		}
	})
	s.on('offer',(data) => {
		let targetUid = data['targetUid']
		if(userMap.get(targetUid)){
			oneToOne(targetUid,getMsg('offer',"rtc offer",200,data))
		}else{
			console.log(targetUid+ "不在线")
		}
	})
	s.on('answer',(data) => {
		let targetUid = data['targetUid']
		if(userMap.get(targetUid)){
			oneToOne(targetUid,getMsg('answer',"rtc answer",200,data))
		}else{
			console.log(targetUid+ "不在线")
		}
	})
}

/**
 * ono to one 
 * @author 
 * @param {Object} uid
 * @param {Object} msg
 */
function oneToOne(uid,msg){
	let s = userMap.get(uid)
	if(s){
		s.emit('msg',msg) //进行广播
	}else{
		console.log(uid+"用户不在线")
	}
}

/**
 * 获取房间用户列表(k-v) 原始KV数据
 * @author 
 * @param {Object} roomId
 */
async function getRoomUser(roomId){
	return await hGetAll(roomKey+roomId)
}

/**
 * 获取房间用户列表(list) 
 * @author 
 * @param {Object} roomId
 */
async function getRoomOnlyUserList(roomId){
	let resList = []
	let uMap = await hGetAll(roomKey+roomId)
	for(const key in uMap){
		let detail = JSON.parse(uMap[key])
		resList.push(detail);
	}
	return resList
}



/**
 * broadcast 多人对话
 * @author suc
 * @param {Object} roomId
 * @param {Object} msg
 */
async function oneToRoomMany(roomId,msg){
	let uMap = await getRoomUser(roomId)
	for(const uid in uMap){ 
	//遍历调用
	  oneToOne(uid,msg)
	}
}