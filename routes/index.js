var express = require('express');
var router = express.Router();
var Discogs = require('disconnect').Client;
var storage = require('node-persist');
var request = require('request-promise');
var consumer_key = process.env.CONSUMER_KEY;
var consumer_secret = process.env.CONSUMER_SECRET;

// Mongodb setup
var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/discogs-api'); // Connection URL
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
  console.log('Connected to mongodb\n');
});
var userSchema = mongoose.Schema({
  name: String,
  discogsId: Number,
  inventory: Array
});
var User = mongoose.model('User', userSchema);

router.get('/', function(req, res, next) {
  storage.init()
    .then(() => {
      return storage.getItem('accessData');
    })
    .then((accessData) => {
      if (!accessData) {
        res.render('login');
      }
      else {
        res.redirect('/main');
      }
    });
});

/*
Next 3 routes (/authorize, /callback, /main) are part of the Discogs auth flow
1. user clicks 'connect' button, calls /authorize route
2. user is redirected to Discogs login page
3. after authenticating Discogs, /callback route is called
4. user is redirected to /main where inventory is shown
*/

router.get('/authorize', function(req, res){
	var oAuth = new Discogs().oauth();
  var callbackUrl_dev = 'http://localhost:3000/callback';
  var callbackUrl_prod = 'https://discogs-api.herokuapp.com/callback';
	oAuth.getRequestToken(
		consumer_key,
		consumer_secret,
		callbackUrl_dev,
		function(err, requestData) {
      storage.init().then(function() {
        storage.setItem('requestData', requestData)
        .then(() => {
          return storage.getItem('requestData');
        })
        .then(() => {
          res.redirect(requestData.authorizeUrl);
        });
      });
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
            return storage.getItem('accessData');
          })
          .then(function(value) {
            res.redirect('main');
          });
        });
      }
    );
  });
});

router.get('/main', function(req, res, next) {
  res.set('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');

  let hbsObject = {
    listings: [],
    username: null
  };

  storage.init()
    // Get Discogs access data
    .then(() => {
      return storage.getItem('accessData');
    })
    // Get Discogs user info
    .then((accessData) => {
      if (!accessData) {
        res.redirect('/');
      }
      else{
        var dis = new Discogs('Discify/1.0', accessData);
        return dis.getIdentity();
      }
    })
    // Save identity to db & hbsObject
    .then((identity) => {
      User.findOne({name: identity.username}, function(err, data) {
        if (err) return handleError(err);
        if (data == null) {
          var user = new User({name: identity.username, discogsId: identity.id});
          user.save(function(err) {
            if (err) return handleError(err);
            console.log('new user ' + identity.username + ' saved to mongodb\n');
          });
        }
        else {
          console.log('user already exists\n');
        }
      });
      hbsObject.username = identity.username;
      return identity.username;
    })
    .then((username) => {
      let data;
      // Get inventory part 1: get number of pages if 100 per page
      // Options for initial get request for inventory
      var getInventory = {
        url: 'https://api.discogs.com/users/' + username + '/inventory?per_page=100',
        headers: {
          'User-Agent': 'Discify/1.0'
        }
      };
      // Callback for get initial get request for inventory
      function showInventory(error, response, body) {
        if (!error && response.statusCode == 200) {
          var data = JSON.parse(body);
          var listings = data.listings;
          var pages = data.pagination.pages;
          hbsObject.listings = listings;
          // console.log('\n/main\nlistings:\n', listings);
          data = data;
        }
        else {
          console.log(error);
        }
      }
      // Initial get request for inventory
      return request(getInventory, showInventory);
    })
    .then((data) => {
      // Callback function to save each listing to db
      function saveInventory(error, response, body) {
        var data2 = JSON.parse(body);
        var listings2 = data2.listings;
        for (var j = 0; j < listings2.length; j++) {
          User.update({name: hbsObject.username}, {$push: {inventory: listings2}}, function(err, doc) {
            if (err) {
              console.log('something went wrong updating db\n', err);
            }
            console.log('db updated\n');
          });
        }
      }
      // In order to get all listings, get data.pagination.pages from initial request,construct for loop to make request for each page
      for (var i = 1; i <= JSON.parse(data).pagination.pages; i++) {
        // Options for second get request for inventory
        var getAllInventory = {
          url: 'https://api.discogs.com/users/' + hbsObject.username + '/inventory?per_page=100&page=' + i,
          headers: {
            'User-Agent': 'Discify/1.0'
          }
        };
        // Second get request for inventory
        request(getAllInventory, saveInventory);
        console.log('request(getAllInventory, saveInventory) called\n');
      }

      console.log('hbsObject:\n', hbsObject);
      res.render('main', hbsObject);
    })
    .catch((error) => {
      console.log('error:\n', error);
    });
}); // end router.get '/main'

router.get('/logout', function(req, res, next) {
  storage.del('accessData').then(function() {
    res.redirect('/');
  });
}); 

module.exports = router;
