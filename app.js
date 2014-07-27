var io = require('socket.io').listen(5002);
var Datastore = require('nedb');
var crypto = require('crypto');

var Wair = {};

// Settings
Wair.c = {} // Config
Wair.c.mexLocationAge = 1000 * 60 * 30;
Wair.c.locationJanitorInterval = 1000 * 60;

// Database
Wair.userdb = new Datastore({filename: './wair_users.db', autoload:true });
Wair.locationdb = new Datastore({filename: './wair_locations.db', autoload:true });
Wair.channeldb = new Datastore({filename: './wair_channels.db', autoload:true });
// Cleaning DB
Wair.userdb.persistence.setAutocompactionInterval(60*1000);
Wair.locationdb.persistence.setAutocompactionInterval(60*1000);
Wair.channeldb.persistence.setAutocompactionInterval(60*1000);

//Methods
Wair.f = {};
Wair.f.tryLogin = function(socket,data){

	var select = null;
	console.log("Got",data);

	// Require
	if(!data) return;
	if(data.username && data.password){
		select = {username:data.username,password:data.password};
	} else if(data.quickkey) {
		select = {quickkey:data.quickkey};
	} else {
		return;
	}

	Wair.userdb.find(select, function(err,docs){
		if(docs.length == 1){
			data.username = docs[0].username; // jic
			Wair.f.forceLogin(socket,data);
		} else {
			socket.emit('login',{
				success:false,
				message:"Invalid Login",
			})
		}
	});
}
Wair.f.leaveChannel = function(socket,data){

	// Require
	if(!data) return;
	if(!data.channelid) return; var channelid = data.channelid;
	socket.get('user',function(e,user){
		var channels = user.channels;
		var id = user.id;
		if(!channels) channels = [];
		if(channels.indexOf(channelid) != -1){
			channels.splice(channels.indexOf(channelid),1);
		}
		wair.userdb.update({_id:id}, {$set: { channels: channels } }, {}, function(err,newDocs){
			if(err)console.log(err);
			socket.emit('leaveChannel',{
				success:true,
				message:"Left Channel",
			})
			return;
		});
	});
	
}
Wair.f.forceChannel = function(socket,data,channel){
	socket.get('user',function(e,user){
		var channels = user.channels;
		var id = user.id;
		if(!channels) channels = [];

		if(channels.indexOf(channel._id) != -1){
			socket.emit('joinChannel',{
				success:false,
				message:"Already in Channel",
			});
			return;
		}

		channels.push(channel._id);
		socket.set('channels',channels);

		wair.userdb.update({_id:id}, {$set: { channels: channels } }, {}, function(err,newDocs){
			if(err)console.log(err);
			socket.emit('joinChannel',{
				success:true,
				message:"Joined Channel",
			});
			return;
		});
	});

}
Wair.f.joinChannel = function(socket,data){

	// Require
	if(!data) return;
	if(!data.channelid) return; var channelid = data.channelid;
	if(!data.channelkey) return; var channelkey = data.channelkey;

	Wair.channeldb.find({ _id: channelid },function(err, docs){
		if(docs.length == 0){
			socket.emit('joinChannel',{
				success:false,
				message:"Invalid Channel",
			});
			return;
		} else {
			var channel = docs[0];
			if(channel.channelkey != channelkey){
				console.log("tried to join",channel,"with",channelkey);
				socket.emit('joinChannel',{
					success:false,
					message:"Invalid Key",
				});
				return;
			}
			Wair.f.forceChannel(socket,data,channel);
		}
	});	
}
Wair.f.getMyChannels = function(socket,data){
	socket.get('user',function(e,user){
		var id = user.id;
		Wair.channeldb.find({owner: id},function(err,docs){
			socket.emit('getMyChannels',{
				success:true,
				message:"Here are your Raisins",
				channels:docs,
			});
			return;
		});
	});
}
Wair.f.createChannel = function(socket,data){

	// Require
	if(!data) return;
	if(!data.channelname) return; var channelname = data.channelname;
	if(!data.channelkey) return; var channelkey = data.channelkey;
	socket.get('user',function(e,user){
		var newChannel = {
			channelname:channelname,
			channelkey:channelkey,
			owner:user.id,
		}
		Wair.channeldb.insert(newChannel,function(err,newDocs){
			if(err)console.log(err);
			socket.emit('createChannel',{
				success:true,
				message:"Created Channel",
			});
			return;
		});
	});

}
Wair.f.forceLogin = function(socket,data){

	// Require
	if(!data) return;
	if(!data.username) return; var username = data.username;

	Wair.userdb.find({username:username}, function(err,docs){
		if(docs.length == 1){
			var user = docs[0];
			socket.set('user',{
				id:user._id,
				auth:true,
				username:user.username,
				channels:user.channels,
			});

			// Authed yay, so attache Priviliged functions
			socket.on('getLocations',function(data){Wair.f.getLocations(socket,data);});
			socket.on('reportLocation',function(data){Wair.f.reportLocation(socket,data);});
			socket.on('joinChannel',function(data){Wair.f.joinChannel(socket,data);});
			socket.on('leaveChannel',function(data){Wair.f.leaveChannel(socket,data);});
			socket.on('createChannel',function(data){Wair.f.createChannel(socket,data);});
			socket.on('getMyChannels',function(data){Wair.f.getMyChannels(socket,data);});

			// Create new Quickkey.
			var qk = user._id + ":" + crypto.randomBytes(32).toString('hex');
			Wair.userdb.update({_id:user._id}, {$set: {quickkey: qk } },{},function(err,newDocs){
				if(err)console.log(err);
			});

			socket.emit('login',{
				success:true,
				message:"Logged In Successfully",
				id:user._id,
				username:user.username,
				channels:user.channels,
				quickkey:qk,
			});
		} else {
			socket.emit('login',{
				success:false,
				message:"Invalid Login",
			});
		}
	});

}
Wair.f.reportLocation = function(socket,data){

	// Require
	if(!data) return;
	if(!("lat" in data)) return; var lat = data.lat;
	if(!("lng" in data)) return; var lng = data.lng;
	var alt = 0; if("alt" in data) var alt = data.alt;

	socket.get('user',function(e,user){
		var userid = user.id;
		var username = user.username;
		var channels = user.channels;

		if(!channels || channels.length == 0){
			socket.emit('reportLocation',{
				success:false,
				message:"You are not in any Channels",
			});
			return;
		}

		Wair.locationdb.remove({uid:userid},{multi:true},function(err,numRemoved){
			var pin = {};
			pin.uid = userid;
			pin.uname = username;
			pin.lat = lat;
			pin.lng = lng;
			pin.alt = alt;
			pin.channels = channels;
			pin.mstr = (new Date().getTime())+"";
			pin.mint = (new Date().getTime());
			Wair.locationdb.insert(pin,function(err,numReplaced){
				socket.emit('reportLocation',{
					success:true,
					message:"Location Reported",
				});
				return;
			});
		});
	});
}
Wair.f.getLocations = function(socket,data){
	socket.get('user',function(e,user){
		var id = user.id;
		Wair.locationdb.find({channels: {$in: user.channels}},function(err,docs){
			for(var loc in docs){
				delete docs[loc].uid;
				delete docs[loc].channels;
				delete docs[loc].mint;
			}
			socket.emit('getLocations',{
				success:true,
				message:"Locations Found",
				locations:docs,
			});
			return;
		});
	});
}
Wair.f.register = function(socket,data){

	// Require
	if(!data) return;
	if(!data.username) return; var username = data.username;
	if(!data.password) return; var password = data.password;

	var errors = [];

	// Basic Checks
	if(!username.match(/^[a-zA-Z0-9]{5,20}$/)){
			errors.push("Name must be alphanumeric, between 5 and 20 chars.");
	}

	// Check for dupes.
	Wair.userdb.find({username:username},function(err, docs){
		if(docs.legnth > 0){
			errors.push("A duplicate username Exists!");
		}
		
		if(errors.legnth > 0){
			socket.emit('register',{
				success:false,
				message:"There were errors",
				errors:errors,
			});
			return;
		}

		var u = {
			username:username,
			password:password, // Yes this shit is insecure, eat a dick, it was made in a fucking rush.
			channels:[]
		}

		Wair.userdb.insert(u,function(err, newDocs){
			if(err)console.log(err);
			socket.emit('register',{
				success:true,
				message:"Successfully Registered",
			});
			Wair.f.forceLogin(socket,data);
			return;
		});

	});
}

Wair.t = {};
Wair.t.locationJanitor = function(){
	var t = new Date().getTime() - Wair.c.maxLocationAge;
	var obj = { $or: [{mint: {$lt:t}}, {mint:{$exists:false}}]};
	console.log(obj);
	Wair.locationdb.remove(obj,{multi:true},function(err,numRemoved){
		console.log(numRemoved,"old locations purged");
	})
}

//Task timer indexes.
Wair.ti = {};
Wair.ti.locationJanitor = setInterval(function(){Wair.t.locationJanitor();},Wair.c.locationJanitorInterval);

console.log('running');

io.on('connection',function(socket){
	console.log('Got Connection');

	socket.on('register',function(data){
		Wair.f.register(socket,data);
	});

	socket.on('login',function(data){
		Wair.f.tryLogin(socket,data);
	});

})