var express = require('express');
var router = express.Router();
var Discogs = require('disconnect').Client;
var storage = require('node-persist');
var request = require('request-promise');
var consumer_key = process.env.CONSUMER_KEY;
var consumer_secret = process.env.CONSUMER_SECRET;

/* db stuff */
var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/discogs-api');// Connection URL
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
  res.render('login');
});

/**
 * Next 3 routes (/authorize, /callback, /main) are part of the Discogs auth flow
 * 1. user clicks 'connect' button, calls /authorize route
 * 2. user is redirected to Discogs login page
 * 3. after authenticating Discogs, /callback route is called
 * 4. user is redirected to /main where inventory is shown
*/

router.get('/authorize', function(req, res){
  console.log('/authorize route called\n');
	var oAuth = new Discogs().oauth();
  var callbackUrl_dev = 'http://localhost:3000/callback';
  var callbackUrl_prod = 'https://discogs-api.herokuapp.com/callback';
	oAuth.getRequestToken(
		consumer_key,
		consumer_secret,
		callbackUrl_dev,
		function(err, requestData){
      storage.init().then(function() {
        storage.setItem('requestData', requestData)
        .then(function() {
          return storage.getItem('requestData');
        })
        .then(function(value) {
          console.log('requestData:\n', value);
        });
        res.redirect(requestData.authorizeUrl);
      });
		}
	);
});

router.get('/callback', function(req, res, next) {
  console.log('/callback route called\n');
  storage.getItem('requestData').then(function(value) {
    var oAuth = new Discogs(value).oauth();
    oAuth.getAccessToken(
      /* Verification code sent back by Discogs */
      req.query.oauth_verifier,
      function(err, accessData){
        storage.init().then(function() {
          storage.setItem('accessData', accessData)
          .then(function() {
            return storage.getItem('accessData');
          })
          .then(function(value) {
            console.log('accessData:\n', value);
            res.redirect('main');
          });
        });
      }
    );
  });
});

router.get('/main', function(req, res, next) {
  console.log('/main route called\n');
  storage.init().then(function() {
    storage.getItem('accessData').then(function(value) {
      var dis = new Discogs('Discify/1.0', value);
    	dis.getIdentity(function(err, identity) {
        if (err) {
          console.log('/main route called\nerror:\n', err);
        }
        // console.log('identity:\n ', identity);
        /* save identity to db */
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

        /* request options */
        var getInventory = {
          url: 'https://api.discogs.com/users/' + identity.username + '/inventory?per_page=100',
          headers: {
            'User-Agent': 'Discify/1.0'
          }
        };
        /* request callback */
        function showInventory(error, response, body) {
          if (!error && response.statusCode == 200) {
            var data = JSON.parse(body);
            var listings = data.listings;
            /**
             * save each to db
            */
            var saveInventory = function(error, response, body) {
              var data = JSON.parse(body);
              var listings = data.listings;
              for (var j = 0; j < listings.length; j++) {
               User.findOneAndUpdate({name: identity.username}, {inventory: listings}, function(err, doc) {
                 if (err) {
                   console.log('something went wrong updating db\n', err);
                 }
                 console.log('db updated\n');
               });
              }
            };
            /**
             * in order to get all listings, get data.pagination.pages from initial request,
             * construct for loop to make request for each page
            */
            for (var i = 1; i <= data.pagination.pages; i++) {
              var getAllInventory = {
                url: 'https://api.discogs.com/users/' + identity.username + '/inventory?per_page=100&page=' + i,
                headers: {
                  'User-Agent': 'Discify/1.0'
                }
              };
              request(getAllInventory, saveInventory);
            }

            // console.log('\n/main\nlistings:\n', listings);
            res.render('main', {listings: listings, identity: identity });
          }
        } /* end showInventory */

        /* initial request in order to get marketplace listings */
        request(getInventory, showInventory);
        
    	}); /* end dis.getIdentity */
    }); /*  end storage.getItem */
  }); /* end storage.init */
}); /* end router.get '/main' */

// shopify stuff to work on next
// const dotenv = require('dotenv').config();
// const crypto = require('crypto');
// const cookie = require('cookie');
// const nonce = require('nonce')();
// const querystring = require('querystring');
//
// const apiKey = process.env.SHOPIFY_API_KEY;
// const apiSecret = process.env.SHOPIFY_API_SECRET;
// const scopes = 'read_products';
// const forwardingAddress = 'https://26f916ce.ngrok.io';
//

//
// router.get('/shopify', (req, res) => {
//   const shop = req.query.shop;
//   if (shop) {
//     const state = nonce();
//     const redirectUri = forwardingAddress + '/shopify/callback';
//     const installUrl = 'https://' + shop +
//       '/admin/oauth/authorize?client_id=' + apiKey +
//       '&scope=' + scopes +
//       '&state=' + state +
//       '&redirect_uri=' + redirectUri;
//
//     res.cookie('state', state);
//     res.redirect(installUrl);
//   } else {
//     return res.status(400).send('Missing shop parameter. Please add ?shop=your-development-shop.myshopify.com to your request');
//   }
// });
//
// router.get('/shopify/callback', (req, res) => {
//   const { shop, hmac, code, state } = req.query;
//   const stateCookie = cookie.parse(req.headers.cookie).state;
//
//   if (state !== stateCookie) {
//     return res.status(403).send('Request origin cannot be verified');
//   }
//
//   if (shop && hmac && code) {
//     // DONE: Validate request is from Shopify
//     const map = Object.assign({}, req.query);
//     delete map['signature'];
//     delete map['hmac'];
//     const message = querystring.stringify(map);
//     const generatedHash = crypto
//       .createHmac('sha256', apiSecret)
//       .update(message)
//       .digest('hex');
//
//     if (generatedHash !== hmac) {
//       return res.status(400).send('HMAC validation failed');
//     }
//
//     // DONE: Exchange temporary code for a permanent access token
//     const accessTokenRequestUrl = 'https://' + shop + '/admin/oauth/access_token';
//     const accessTokenPayload = {
//       client_id: apiKey,
//       client_secret: apiSecret,
//       code,
//     };
//
//     request.post(accessTokenRequestUrl, { json: accessTokenPayload })
//     .then((accessTokenResponse) => {
//       const accessToken = accessTokenResponse.access_token;
//       // DONE: Use access token to make API call to 'shop' endpoint
//       const shopRequestUrl = 'https://' + shop + '/admin/shop.json';
//       const shopRequestHeaders = {
//         'X-Shopify-Access-Token': accessToken,
//       };
//
//       request.get(shopRequestUrl, { headers: shopRequestHeaders })
//       .then((shopResponse) => {
//         res.status(200).end(shopResponse);
//       })
//       .catch((error) => {
//         res.status(error.statusCode).send(error.error.error_description);
//       });
//     })
//     .catch((error) => {
//       res.status(error.statusCode).send(error.error.error_description);
//     });
//
//   } else {
//     res.status(400).send('Required parameters missing');
//   }
// });

module.exports = router;
