// server.js
// Server Initialization
var express = require('express');
var app = express();
var session = require('express-session');
var server = require('http').createServer(app);
var io = require('socket.io').listen(server);
var PORT = (process.env.PORT || 3000);

var mysql = require('mysql');

var Twit = require('twit');
var twitConfig = require('./config.js');
var T = new Twit(twitConfig);

// (Client, Connections, Twitter API Stream) monitor variables/arrays
moderators = [];
displays = [];
connections = [];
displayQueue = {
	startDisplayQueueID: null,
	curDisplayQueueID: null,
	curBasePhoto: 0,
	basePhotosURL: 'http://cdn.jixabon.com/i/missi-wedding/',
	basePhotos: [
			"1988BryLori4Months.jpg",
			"1989BryClair1Year.jpg",
			"1990BrySummer(3).jpg",
			"1991BryBrad.jpg",
			"1996Bry.jpg",
			"IMG_1723.jpg",
			"IMG_1766.jpg",
			"IMG_1783.jpg",
			"IMG_1819.jpg",
			"IMG_1823.jpg",
			"IMG_1847.jpg",
			"IMG_1910.jpg",
			"IMG_3566.PNG",
			"IMG_3567.PNG",
			"IMG_3568.PNG",
			"IMG_3577.PNG",
			"IMG_3578.PNG",
			"Wedding1.jpg",
			"Wedding10.jpg",
			"Wedding11.jpg",
			"Wedding12.jpg",
			"Wedding13.jpg",
			"Wedding14.jpg",
			"Wedding15.jpg",
			"Wedding16.jpg",
			"Wedding17.jpg",
			"Wedding18.jpg",
			"Wedding19.jpg",
			"Wedding2.jpg",
			"Wedding20.jpg",
			"Wedding3.jpg",
			"Wedding4.jpg",
			"Wedding6.jpg",
			"Wedding7.jpg",
			"Wedding5.jpg",
			"Wedding8.jpg",
			"Wedding9.jpg"
				]
}
show = {
	running: false,
	id: '',
	tittle: null,
	hashtag: null,
	otherTerms: null,
	waitingTweets: null
};

var stream = null;

// Server configuration

app.use(session({
	secret: '9zmh32nAP7U08RX41VQf8btutUF43pz9',
	resave: true,
	saveUninitialized: true
}));

app.use(express.static(__dirname + '/public'));

var con = mysql.createPool({
	host: 'localhost',
	user: 'root',
	password: 'root',
	database: 'TwitterDisplay'
});

server.listen(PORT);
console.log('[Server]: Started - listening on port: ' + PORT);

// Authentication and Authorization Middleware
var auth = function(req, res, next) {
	if (true/*req.session && req.session.user === "admin" && req.session.admin*/) {
		return next();
	} else {
		return res.redirect('/');
	}
};

// Page serving
app.get('/', function(req, res) {
	res.sendFile(__dirname + '/login.html');
});

app.get('/login', function(req, res) {
	console.log('[System]: Logging in');
	if (req.query.username === "Missi" && req.query.password === "w3ddingtime") {
		console.log('[System]: Log in successfull');
		req.session.user = "admin";
		req.session.admin = true;
		res.redirect('/moderate');
	} else {
		console.log('[System]: Log in unsuccessfull - Fields didn\'t match');
		res.redirect('/?loginSuccess=false');
	}
});

app.get('/logout', function(req, res) {
	req.session.destroy();
	console.log('[System]: Log out successfull');
	res.sendFile(__dirname + '/logout.html');
})

app.get('/display', auth, function(req, res) {
	res.sendFile(__dirname + '/display.html');
});

app.get('/moderate', auth, function(req, res) {
	res.sendFile(__dirname + '/moderate/index.html');
});

app.get('/timeline', auth, function(req, res) {
	res.sendFile(__dirname + '/timeline.html');
});

app.get('/moderate/tweets', auth, function(req, res) {
	res.sendFile(__dirname + '/moderate/tweets.html');
});

app.get('/moderate/shows', auth, function(req, res) {
	res.sendFile(__dirname + '/moderate/shows.html');
});

app.get('/moderate/start_show', auth, function(req, res) {
	res.sendFile(__dirname + '/moderate/startShow.html');
});

app.get('/moderate/stop_show', auth, function(req, res) {
	res.sendFile(__dirname + '/moderate/stopShow.html');
});

// Socket definitions
io.sockets.on('connection', function(socket) {
	// Add to total connections array
	connections.push(socket);

	// Log what connections exist
	console.log('[Connected]: %s sockets connected', connections.length);

	// Add moderators or displays
	socket.on('moderator', function() {
		if (moderators.indexOf(socket.id) === -1) {
			moderators.push(socket.id);
			updateInfo();

			// Log what connections exist
			console.log('[Moderators]: %s', moderators.length);
		}
	});

	socket.on('display', function() {
		if (displays.indexOf(socket.id) === -1) {
			displays.push(socket.id);
			updateInfo();

			// Log what connections exist
			console.log('[Displays]: %s', displays.length);
		}
	});

	socket.on('start show', function(data) {

		show.running = true;
		show.title = data.title;
		show.hashtag = data.hashtag;
		show.otherTerms = data.otherTerms;

		var show_values = {
			title: show.title,
			hashtag: show.hashtag,
			other_terms: show.otherTerms
		};

		// Insert show data into database
		con.getConnection(function(err, connection) {

			connection.query('INSERT INTO `show` SET ?', show_values, function(err, result) {
				if (err) {
					console.log('[MySQL]: ' + err)
				} else {
					show.id = result.insertId;
					console.log('[MySQL]: Show - Last insert ID: ' + result.insertId);

					var bp_values_A = {
						show_id: show.id,
						isTweet: 0,
						baseImgURL: displayQueue.basePhotosURL + displayQueue.basePhotos[displayQueue.curBasePhoto]
					};

					con.getConnection(function(err, connection) {
						connection.query('INSERT INTO `displayQueue` SET ?', bp_values_A, function(err, result) {
							if (err) {
								console.log('[MySQL]: ' + err)
							} else {
								displayQueue.startDisplayQueueID = result.insertId;
								displayQueue.curDisplayQueueID = result.insertId;
								displayQueue.curBasePhoto++;
								console.log('[MySQL]: Added to Display Queue - Last insert ID: ' + result.insertId);
							}
						});

						connection.release();
					});
				}
			});

			connection.release();
		});

		newImageInterval = setInterval(function() {
			con.getConnection(function(err, connection) {

				connection.query('SELECT * FROM displayQueue AS dq LEFT JOIN tweet AS t ON dq.tweet_id = t.id WHERE dq.id = ?', [displayQueue.curDisplayQueueID], function(err, rows) {
					if (err) {
						console.log('[MySQL]: ' + err);
					} else {
						if (rows.length < 1) {
							debug(rows.length);
							debug(rows.length == -1);
							debug("restarting Queue");
							displayQueue.curDisplayQueueID = displayQueue.startDisplayQueueID;
						}
						else {
							debug(rows.length);
							debug('sending display' + displayQueue.curDisplayQueueID);
							socket.broadcast.emit('new image', rows);
							socket.emit('new image', rows);
							console.log('[MySQL]: Display Queue - Sent New Image');
							displayQueue.curDisplayQueueID++;
						}
					}
				});

				connection.release();
			});

			if (displayQueue.curBasePhoto < displayQueue.basePhotos.length) {
				var bp_values_D = {
					show_id: show.id,
					isTweet: 0,
					baseImgURL: displayQueue.basePhotosURL + displayQueue.basePhotos[displayQueue.curBasePhoto]
				};

				con.getConnection(function(err, connection) {
					connection.query('INSERT INTO `displayQueue` SET ?', bp_values_D, function(err, result) {
						if (err) {
							console.log('[MySQL]: ' + err)
						} else {
							console.log('[MySQL]: Added to Display Queue - Last insert ID: ' + result.insertId);
						}
					});

					connection.release();
				});

				displayQueue.curBasePhoto++;
				debug(displayQueue.curBasePhoto);
			}
		}, 1000 * 8);

		var tracking = '#' + show.hashtag + ',' + show.otherTerms;

		console.log('[Show]: Created - Title: ' + show.title + ' Tracking: ' +  tracking);

		if (stream === null) {
			stream = T.stream('statuses/filter', { track: [tracking]});
			console.log('[Stream]: Started');
			stream.on('tweet', function(data) {
				// Tweet information being sent to the clients
				var tweet = {
					id: null,
					user_name: data.user.name,
					screen_name: data.user.screen_name,
					profile_image_url: data.user.profile_image_url,
					text: data.text,
					created_at: data.created_at,
					image_url: ''
				};

				// Add tweet info to the database
				var values = {
					show_id: show.id,
					user_name: data.user.name,
					screen_name: data.user.screen_name,
					profile_image_url: data.user.profile_image_url,
					text: data.text,
					created_at: data.created_at,
					image_url: ''
				};

				if (data.entities.hasOwnProperty('media')) {
					if (data.entities.media[0].type === 'photo') {
						tweet.image_url = data.entities.media[0].media_url;
						values.image_url = data.entities.media[0].media_url;
					}
				}

				con.getConnection(function(err, connection) {

					connection.query('INSERT INTO tweet SET ?', values, function(err, result) {
						if (err) {
							console.log('[MySQL]: ' + err);
						} else {
							tweet.id = result.insertId;
							socket.broadcast.emit('new tweet', tweet);
							socket.emit('new tweet', tweet);
							console.log('[MySQL]: Tweet - Last insert ID: ' + result.insertId);
						}
					});

					connection.release();
				});

				
				console.log('[Stream]: New Tweet');
			});
		}
	});

	socket.on('stop show', function() {
		stopStream();
	});

	socket.on('get old tweets', function() {

		con.getConnection(function(err, connection) {

			connection.query('SELECT * FROM tweet WHERE `show_id` = ? AND `status` = ?', [show.id, 'waiting'], function(err, rows) {
				if (err) {
					console.log('[MySQL]: ' + err);
					return;
				} else {
					socket.broadcast.emit('old tweets', rows);
					socket.emit('old tweets', rows);
					console.log('[MySQL]: Tweet - Sent old tweets');
				}
			});

			connection.release();
		});
		
	});

	socket.on('get old shows', function() {

		con.getConnection(function(err, connection) {

			connection.query('SELECT * FROM `show`', function(err, rows) {
				if (err) {
					console.log('[MySQL]: ' + err);
					return;
				} else {
					socket.broadcast.emit('old shows', rows);
					socket.emit('old shows', rows);
					console.log('[MySQL]: Show - Sent old shows');
				}
			});

			connection.release();
		});
		
	});

	socket.on('tweet authorized', function(data) {
		var confirm = {
			tweetId: data.tweetId,
			status: 'authorized',
			success: null
		};

		// mysql to change database to authorized
		con.getConnection(function(err, connection) {

			connection.query('UPDATE tweet SET status = ? WHERE id = ?', ['authorized', data.tweetId], function(err, result) {
				if (err) {
					console.log('[MySQL]: ' + err);
					confirm.success = false;
					socket.broadcast.emit('tweet status', confirm);
					socket.emit('tweet status', confirm);
					return;
				} else {
					console.log('[MySQL]: Tweet - Authorized: ' + confirm.tweetId);

					connection.query('SELECT * FROM tweet WHERE id = ?', data.tweetId, function(err, result) {
						if (err) {
							console.log('[MySQL]: ' + err);
							confirm.success = false;
							return;
						} else {
							confirm.success = true;

							if (result[0].image_url === '') {
								// Send to timeline
								socket.broadcast.emit('new timeline tweet', result[0]);
								socket.emit('new timeline tweet', result[0]);
								console.log('[MySQL]: Tweet - Sent to Display: ' + confirm.tweetId);
							} else {
								var displayTweetInfo = {
									show_id: show.id,
									isTweet: 1,
									tweet_id: confirm.tweetId
								}

								con.getConnection(function(err, connection) {
									connection.query('INSERT INTO `displayQueue` SET ?', displayTweetInfo, function(err, result) {
										if (err) {
											console.log('[MySQL]: ' + err)
										} else {
											console.log('[MySQL]: Added to Display Queue - Last insert ID: ' + result.insertId);
										}
									});

									connection.release();
								});
							}

							socket.broadcast.emit('tweet status', confirm);
							socket.emit('tweet status', confirm);
						}
					});
				}
			});


			connection.release();
		});
	});

	socket.on('tweet unauthorized', function(data) {
		var confirm = {
			tweetId: data.tweetId,
			status: 'unauthorized',
			success: null
		};

		// mysql to change database to unauthorized
		con.getConnection(function(err, connection) {

			connection.query('UPDATE tweet SET status = ? WHERE id = ?', ['unauthorized', data.tweetId], function(err, result) {
				if (err) {
					console.log('[MySQL]: ' + err);
					confirm.success = false;
					socket.broadcast.emit('tweet status', confirm);
					socket.emit('tweet status', confirm);
					return;
				} else {
					confirm.success = true;

					socket.broadcast.emit('tweet status', confirm);
					socket.emit('tweet status', confirm);
					console.log('[MySQL]: Tweet - Unauthorized: ' + confirm.tweetId);
				}
			});

			connection.release();
		});
	});

	socket.on('Get Current Display', function() {

		con.getConnection(function(err, connection) {

			connection.query('SELECT * FROM displayQueue AS dq LEFT JOIN tweet AS t ON dq.tweet_id = t.id WHERE dq.id = ?', [displayQueue.curDisplayQueueID], function(err, rows) {
				if (err) {
					console.log('[MySQL]: ' + err);
					return;
				} else {
					socket.broadcast.emit('new image', rows);
					socket.emit('new image', rows);
					console.log('[MySQL]: Display Queue - Sent Current Display');
				}
			});

			connection.release();
		});
	});

	socket.on('Get Hashtag', function() {
		socket.broadcast.emit('Hashtag', show.hashtag);
		socket.emit('Hashtag', show.hashtag);
		console.log('[MySQL]: Show - Sent hashtag');
	});

	socket.on('disconnect', function(e) {
		connections.splice(connections.indexOf(socket), 1);
		if (moderators.indexOf(socket.id) != -1) {
			moderators.splice(moderators.indexOf(socket.id), 1);
		} else if (displays.indexOf(socket.id) != -1) {
			displays.splice(displays.indexOf(socket.id), 1);
		}

		clearTimeout(countdown);
		var countdown = setTimeout(function() {	
			if (connections.length == 0 && stream !== null) {
				console.log('[Countdown]: Started')
				setTimeout(function() { (connections.length == 0) ? stopStream() : console.log('[Countdown]: Failed') }, 1000*60*7);
			}
		}, 1000*8);

		updateInfo();
		console.log('[Disconnected]: %s sockets connected with %s displays and %s moderators', connections.length, displays.length, moderators.length);
	});

	function updateInfo() {
		socket.broadcast.emit('updateInfo', {show: show, displayCount: displays.length});
		socket.emit('updateInfo', {show: show, displayCount: displays.length});
	}

	function sendToDisplay(data) {
		// Get authorized tweet info and send it to timeline (if no photo) or display (if photo)
		con.getConnection(function(err, connection) {

			connection.query('SELECT * FROM tweet WHERE id = ?', [data.tweetId], function(err, rows) {
				if (err) {
					console.log('[MySQL]: Displaying - ' + err);
					return;
				} else {
					if (rows.length === 1) {
						if (rows.image_url === '') {
							socket.broadcast.emit('new timeline tweet', rows);
							socket.emit('new timeline tweet', rows);
						} else {

						}
					}

					console.log('[MySQL]: Tweet - Sent to Display: ' + confirm.tweetId);
				}
			});

			connection.release();
		});
	}

	function sendToTimeline(connection, data) {
		// Get authorized tweet info and send it to timeline (if no photo) or display (if photo)
		connection.query('SELECT * FROM tweet WHERE id = ?', [data.tweetId], function(err, rows) {
			if (err) {
				console.log('[MySQL]: Displaying - ' + err);
				return;
			} else {
				if (rows.length === 1) {
					if (rows.image_url === '') {
						socket.broadcast.emit('new timeline tweet', rows);
						socket.emit('new timeline tweet', rows);
					} else {

					}
				}

				console.log('[MySQL]: Tweet - Sent to Display: ' + confirm.tweetId);
			}
		});
	}

	function stopStream() {
		if (stream !== null) {
			stream.stop();
			console.log('[Stream]: Stopped');
			show = {
				running: false,
				tittle: null,
				hashtag: null,
				otherTerms: null
			};
			clearInterval(newImageInterval);
			newImageInterval = null;
			console.log('[Show]: Stopped');
		} else {
			console.log('[Stream]: Not running');
		}
		stream = null;
	}

	function debug(msg) {
		console.log('[Debug]: ' + msg);
	}
});