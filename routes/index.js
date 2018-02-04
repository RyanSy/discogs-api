var express = require('express');
var router = express.Router();
var Discogs = require('disconnect').Client;
var storage = require('node-persist');
var request = require('request');
var consumer_key = process.env.CONSUMER_KEY;
var consumer_secret = process.env.CONSUMER_SECRET;

router.get('/', function(req, res, next) {
  res.render('login');
});

// Next 3 routes (/authorize, /callback, /main) are part of the Discogs auth flow
router.get('/authorize', function(req, res){
	var oAuth = new Discogs().oauth();
	oAuth.getRequestToken(
		consumer_key,
		consumer_secret,
		'http://localhost:3000/callback',
		function(err, requestData){
      storage.init().then(function() {
        storage.setItem('requestData', requestData)
        .then(function() {
          return storage.getItem('requestData')
        })
        .then(function(value) {
          console.log('\n/authorize\nrequestData:\n', value);
        });
      });
			res.redirect(requestData.authorizeUrl);
		}
	);
});

router.get('/callback', function(req, res, next) {
  storage.getItem('requestData').then(function(value) {
    var oAuth = new Discogs(value).oauth();
    oAuth.getAccessToken(
      // Verification code sent back by Discogs
      req.query.oauth_verifier,
      function(err, accessData){
        storage.init().then(function() {
          storage.setItem('accessData', accessData)
          .then(function() {
            return storage.getItem('accessData')
          })
          .then(function(value) {
            console.log('\n/callback\naccessData: ', value);
            res.redirect('main');
          });
        });
      }
    );
  });
});

router.get('/main', function(req, res, next) {
  storage.getItem('accessData').then(function(value) {
    var dis = new Discogs('Discify/1.0', value);
  	dis.getIdentity(function(err, identity) {
      if (err) {
        console.log('\n/main\nerror:\n', err);
      }
      console.log('\n/main\nidentity:\n ', identity);
      var getInventory = {
        url: 'https://api.discogs.com/users/' + identity.username + '/inventory',
        headers: {
          'User-Agent': 'Discify/1.0'
        }
      };
      function showInventory(error, response, body) {
        if (!error && response.statusCode == 200) {
          var data = JSON.parse(body);
          var listings = data.listings;
          console.log('\n/main\nlistings:\n', listings);
          res.render('main', {listings: listings});
        }
      }
      request(getInventory, showInventory);
  	});
  });
});

module.exports = router;
