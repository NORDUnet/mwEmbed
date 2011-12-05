/**
* Supports the display of kaltura VAST ads. 
*/
( function( mw, $ ) {

	
mw.KAdPlayer = function( embedPlayer ) {
	// Create the KAdPlayer
	return this.init( embedPlayer );
};

mw.KAdPlayer.prototype = {

	// Ad tracking postFix: 
	trackingBindPostfix: '.AdTracking',

	// Use Video sibling element
	enableVideoSibling: false,
	
	// The local interval for monitoring ad playback: 
	adMonitorInterval: null,
	
	init: function( embedPlayer ){
		this.embedPlayer = embedPlayer;
	},
	
	/**
	 * Display a given adSlot
	 * once done issues the "displayDoneCallback"
	 * 
	 * @param {Object}
	 *          adSlot AdadSlot object
	 * @param {function}
	 *          displayDoneCallback The callback function called once the display
	 *          request has been completed
	 * @param {=number} 
	 * 			displayDuration optional time to display the insert useful 
	 * 			ads that don't have an inherent duration. 
	 */
	display: function( adSlot, displayDoneCallback, displayDuration ) {
		var _this = this;
		mw.log("KAdPlayer::display:" + adSlot.type + ' ads:' +  adSlot.ads.length );
		
		// Setup some configuration for done state:
		adSlot.doneFunctions = [];
		
		// Setup local pointer to displayDoneCallback
		adSlot.doneCallback = displayDoneCallback;
		
		adSlot.playbackDone = function(){
			mw.log("KAdPlayer:: display: adSlot.playbackDone" );
			// remove the video sibling ( used for ad playback )
			_this.restoreEmbedPlayer();
			// Remove notice if present: 
			$('#' + _this.embedPlayer.id + '_ad_notice' ).remove();
			// Remove skip button if present: 
			$('#' + _this.embedPlayer.id + '_ad_skipBtn' ).remove();
			
			while( adSlot.doneFunctions.length ){
				adSlot.doneFunctions.shift()();
			}
			adSlot.currentlyDisplayed = false;
			// give time for the end event to clear
			setTimeout(function(){
				adSlot.doneCallback();
			}, 50);
		};
		
		// If the current ad type is already being displayed don't do anything
		if( adSlot.currentlyDisplayed === true ){
			adSlot.playbackDone();
			return ;
		}
		
		// Check that there are ads to display:
		if (!adSlot.ads || adSlot.ads.length == 0 ){
			adSlot.playbackDone();
			return;
		}
		// Choose a given ad from the 
		var adConf = this.selectFromArray( adSlot.ads );
		
		// If there is no display duration and no video files, issue the callback directly )
		// ( no ads to display )
		if( !displayDuration && ( !adConf.videoFiles || adConf.videoFiles.length == 0 ) ){
			adSlot.playbackDone();
			return;
		}
		
		// Setup the currentlyDisplayed flag: 
		if( !adSlot.currentlyDisplayed ){
			adSlot.currentlyDisplayed = true;
		}

		
		// Start monitoring for display duration end ( if not supplied we depend on videoFile end )
		if( displayDuration ){
			// Monitor time for display duration display utility function
			var startTime = _this.getNativePlayerElement().currentTime;		
			this.monitorForDisplayDuration( adSlot, startTime, displayDuration );		
		} 
		
		// Check for videoFiles inserts:
		if ( adConf.videoFiles && adConf.videoFiles.length && adSlot.type != 'overlay' ) {
			this.displayVideoFile( adSlot, adConf );
		}

		// Check for companion ads:
		if ( adConf.companions && adConf.companions.length ) {
			this.displayCompanions(  adSlot, adConf, adSlot.type);
		};
		
		// Check for nonLinear overlays
		if ( adConf.nonLinear && adConf.nonLinear.length && adSlot.type == 'overlay' ) {
			this.displayNonLinear( adSlot, adConf );
		}		
		
		// Check if should fire any impression beacon(s) 
		if( adConf.impressions && adConf.impressions.length ){
			// Fire all the impressions
			for( var i =0; i< adConf.impressions; i++ ){
				mw.sendBeaconUrl( adConf.impressions[i].beaconUrl );
			}
		}
	},
	
	/**
	 * Used to monitor overlay display time
	 */
	monitorForDisplayDuration: function( adSlot, startTime, displayDuration ){
		var _this = this;
		// Local base video monitor function: 
		var vid = _this.getNativePlayerElement();
		// Stop display of overlay if video playback is no longer active
		if( typeof vid == 'undefined'
			||
			 _this.getNativePlayerElement().currentTime - startTime > displayDuration 
		){
			mw.log( "KAdPlayer::display:" + adSlot.type + " Playback done because vid does not exist or > displayDuration " + displayDuration );
			adSlot.playbackDone();
		} else {
			setTimeout( function(){
				_this.monitorForDisplayDuration( adSlot, startTime, displayDuration );
			}, mw.getConfig( 'EmbedPlayer.MonitorRate' ) );
		}
	},
	/**
	 * Display a video slot
	 * @param adSlot
	 * @param adConf
	 * @return
	 */
	displayVideoFile: function( adSlot, adConf ){
		var _this = this;
		var adClickPostFix = '.adClick';
		// check that we have a video to display: 
		var targetSrc =  _this.embedPlayer.getCompatibleSource( adConf.videoFiles );
		if( !targetSrc ){
			mw.log("KAdPlayer:: displayVideoFile> Error no adSlot video src ");
			adSlot.playbackDone();
			return ;
		}
		// Check for click binding 
		if( adConf.clickThrough ){	
			var clickedBumper = false;
			$( _this.embedPlayer ).bind( 'click' + adClickPostFix, function(){
				// Show the control bar with a ( force on screen option for iframe based clicks on ads ) 
				_this.embedPlayer.controlBuilder.showControlBar( true );
				$( _this.embedPlayer ).bind( 'onplay' + adClickPostFix, function(){
					$( _this.embedPlayer ).unbind( 'onplay' + adClickPostFix );
					_this.embedPlayer.controlBuilder.restoreControlsHover();
				})
				// try to do a popup:
				if(!clickedBumper){
					clickedBumper = true;
					window.open( adConf.clickThrough );								
					return false;
				}
				return true;							
			});
		}
		
		// Play the ad as sibbling to the current video element.
		if( _this.enableVideoSibling ) {
			_this.playVideoSibling( targetSrc,
					function( vid ) {
						if( !vid ){
							mw.log("KAdPlayer:: Error: displayVideoFile no video in playVideoSibling callback " );
							return ;
						}
						mw.log("KAdPlayer:: source updated, add tracking");
						// Bind all the tracking events ( currently vast based but will abstract if needed )
						if( adConf.trackingEvents ){
							_this.bindTrackingEvents( adConf.trackingEvents );
						}
						var helperCss = {
							'position': 'absolute',
							'color' : '#FFF',
							'font-weight':'bold',
							'text-shadow': '1px 1px 1px #000'
						};
						// Check runtimeHelper ( notices
						if( adSlot.notice ){
							var noticeId =_this.embedPlayer.id + '_ad_notice';
							// Add the notice target:
							_this.embedPlayer.$interface.append(
								$('<span />')
									.attr('id', noticeId)
									.css( helperCss )
									.css('font-size', '90%')
									.css( adSlot.notice.css )
							);
							var localNoticeCB = function(){
								if( vid && $('#' + noticeId).length ){
									var timeLeft = Math.round( vid.duration - vid.currentTime );
									if( isNaN( timeLeft ) ){
										timeLeft = '...';
									}
									$('#' + noticeId).text(
										adSlot.notice.text.replace('$1', timeLeft)
									);
									setTimeout( localNoticeCB,  mw.getConfig( 'EmbedPlayer.MonitorRate' ) );
								}
							};
							localNoticeCB();
						}
						// Check for skip add button
						if( adSlot.skipBtn ){
							var skipId = _this.embedPlayer.id + '_ad_skipBtn';
							_this.embedPlayer.$interface.append(
								$('<span />')
									.attr('id', skipId)
									.text( adSlot.skipBtn.text )
									.css( helperCss )
									.css('cursor', 'pointer')
									.css( adSlot.skipBtn.css )
									.click(function(){
										$( _this.embedPlayer ).unbind( 'click' + adClickPostFix );
										adSlot.playbackDone();
									})
							);
							// TODO move up via layout engine ( for now just the control bar )
							var bottomPos = parseInt( $('#' +skipId ).css('bottom') );
							if( !isNaN( bottomPos ) ){
								$('#' +skipId ).css('bottom', bottomPos + _this.embedPlayer.controlBuilder.getHeight() );
							}
						}

					},
					function(){
						// unbind any click ad bindings:
						$( _this.embedPlayer ).unbind( 'click' + adClickPostFix );
						adSlot.playbackDone();
					}
			);

			return ;
		} else {
			// Play the source then run the callback
			_this.embedPlayer.switchPlaySrc( targetSrc,
				function(vid) {
					if( !vid ){
						mw.log("KAdPlayer:: Error: displayVideoFile no video in switchPlaySrc callback " );
						return ;
					}
					mw.log("KAdPlayer:: source updated, add tracking");
					// Bind all the tracking events ( currently vast based but will abstract if needed )
					if( adConf.trackingEvents ){
						_this.bindTrackingEvents( adConf.trackingEvents );
					}
					var helperCss = {
						'position': 'absolute',
						'color' : '#FFF',
						'font-weight':'bold',
						'text-shadow': '1px 1px 1px #000'
					};
					// Check runtimeHelper ( notices
					if( adSlot.notice ){
						var noticeId =_this.embedPlayer.id + '_ad_notice';
						// Add the notice target:
						_this.embedPlayer.$interface.append(
							$('<span />')
								.attr('id', noticeId)
								.css( helperCss )
								.css('font-size', '90%')
								.css( adSlot.notice.css )
						);
						var localNoticeCB = function(){
							if( vid && $('#' + noticeId).length ){
								var timeLeft = Math.round( vid.duration - vid.currentTime );
								if( isNaN( timeLeft ) ){
									timeLeft = '...';
								}
								$('#' + noticeId).text(
									adSlot.notice.text.replace('$1', timeLeft)
								);
								setTimeout( localNoticeCB,  mw.getConfig( 'EmbedPlayer.MonitorRate' ) );
							}
						};
						localNoticeCB();
					}
					// Check for skip add button
					if( adSlot.skipBtn ){
						var skipId = _this.embedPlayer.id + '_ad_skipBtn';
						_this.embedPlayer.$interface.append(
							$('<span />')
								.attr('id', skipId)
								.text( adSlot.skipBtn.text )
								.css( helperCss )
								.css('cursor', 'pointer')
								.css( adSlot.skipBtn.css )
								.click(function(){
									$( _this.embedPlayer ).unbind( 'click' + adClickPostFix );
									adSlot.playbackDone();
								})
						);
						// TODO move up via layout engine ( for now just the control bar )
						var bottomPos = parseInt( $('#' +skipId ).css('bottom') );
						if( !isNaN( bottomPos ) ){
							$('#' +skipId ).css('bottom', bottomPos + _this.embedPlayer.controlBuilder.getHeight() );
						}
					}

				},
				function(){
					// unbind any click ad bindings:
					$( _this.embedPlayer ).unbind( 'click' + adClickPostFix );
					adSlot.playbackDone();
				}
			);
		}
	},
	/**
	 * Display companion ads
	 * @param adSlot
	 * @param adConf
	 * @return
	 */
	displayCompanions:  function( adSlot, adConf, timeTargetType ){
		var _this = this;
		mw.log("KAdPlayer::displayCompanions: " + timeTargetType );
		// NOTE:: is not clear from the ui conf response if multiple
		// targets need to be supported, and how you would do that
		var companionTargets = adSlot.companionTargets;
		// Make sure we have some companion targets:
		if( ! companionTargets || !companionTargets.length ){
			return ;
		}
		// Store filledCompanion ids
		var filledCompanions = {};
		// Go though all the companions see if there are good companionTargets
		$.each( adConf.companions, function( inx, companion ){			
			// Check for matching size: 
			// TODO we should check for multiple matching size companions 
			// ( although VAST should only return one of matching type )
			$.each( companionTargets, function( cInx, companionTarget){
				if( companionTarget.width ==  companion.width && 
						companionTarget.height == companion.height )
				{			
					if( !filledCompanions[ companionTarget.elementid ]){
						_this.displayCompanion( adSlot, companionTarget, companion);
						filledCompanions[ companionTarget.elementid ] = true;
					}
				}
			});
		});
	},
	displayCompanion: function( adSlot, companionTarget, companion ){
		var _this = this;
		var originalCompanionHtml = $('#' + companionTarget.elementid ).html();
		// Display the companion if local to the page target:
		if( $( '#' + companionTarget.elementid ).length ){
			$( '#' + companionTarget.elementid ).html( companion.html );
		}
		
		// Display the companion across the iframe client
		var companionObject = {
			'elementid' : companionTarget.elementid,
			'html' : companion.html
		};
		_this.embedPlayer.triggerHelper( 'AdSupport_UpdateCompanion', [ companionObject ] );
	},
	/**
	 * Display a nonLinier add ( like a banner overlay )
	 * @param adSlot
	 * @param adConf
	 * @return
	 */
	displayNonLinear: function( adSlot, adConf ){
		var _this = this;
		var overlayId =  _this.embedPlayer.id + '_overlay';
		var nonLinearConf = _this.selectFromArray( adConf.nonLinear ); 
		
		// Add the overlay if not already present: 
		if( $('#' +overlayId ).length == 0 ){
			_this.embedPlayer.$interface.append(
				$('<div />')					
				.css({
					'position':'absolute',
					'z-index' : 1
				})
				.attr('id', overlayId )				
			);
		}
		var layout = {
			'width' : nonLinearConf.width + 'px',
			'height' : nonLinearConf.height + 'px',
			'left' : '50%',
			'margin-left': -(nonLinearConf.width /2 )+ 'px'
		};			
		
		// check if the controls are visible ( @@todo need to replace this with 
		// a layout engine managed by the controlBuilder ) 
		if( _this.embedPlayer.$interface.find( '.control-bar' ).is(':visible') ){
			layout.bottom = (_this.embedPlayer.$interface.find( '.control-bar' ).height() + 10) + 'px';
		} else {
			layout.bottom = '10px';
		}
		
		// Show the overlay update its position and content
		$('#' +overlayId )
		.css( layout )
		.html( nonLinearConf.html )
		.fadeIn('fast')
		.append(
			// Add a absolute positioned close button: 
			$('<span />')
			.css({
				'top' : 0,
				'right' : 0,
				'position': 'absolute',
				'cursor' : 'pointer'
			})
			.addClass("ui-icon ui-icon-closethick")				
			.click(function(){
				$( this ).parent().fadeOut('fast');
			})
		);
		
		
		// Bind control bar display hide / show
		$( _this.embedPlayer ).bind( 'onShowControlBar', function(event,  layout ){
			if( $('#' +overlayId ).length )
				$('#' +overlayId ).animate( layout, 'fast');
		});
		$( _this.embedPlayer ).bind( 'onHideControlBar', function(event, layout ){
			if( $('#' +overlayId ).length )
				$('#' +overlayId ).animate( layout, 'fast');
		});
		
		// Only display the the overlay for allocated time:
		adSlot.doneFunctions.push(function(){
			$('#' +overlayId ).fadeOut('fast');
		});
		
	},
	
	/**
	 * bindVastEvent per the VAST spec the following events are supported:
	 *   
	 * start, firstQuartile, midpoint, thirdQuartile, complete
	 * pause, rewind, resume, 
	 * 
	 * VAST events not presently supported ( per iOS player limitations ) 
	 * 
	 * mute, creativeView, unmute, fullscreen, expand, collapse, 
	 * acceptInvitation, close
	 * 
	 * @param {object} trackingEvents
	 */	
	bindTrackingEvents: function ( trackingEvents ){
		var _this = this;
		var videoPlayer = _this.getVideoAdSiblingElement();
		var bindPostfix = _this.trackingBindPostfix;
		// unbind any existing adTimeline events
		$( videoPlayer).unbind( bindPostfix );
		
		// Only send events once: 
		var sentEvents = {};
		
		// Function to dispatch a beacons:
		var sendBeacon = function( eventName, force ){
			if( sentEvents[ eventName ] && !force ){
				return ;
			} 
			sentEvents[ eventName ] = 1;
			// See if we have any beacons by that name: 
			for(var i =0;i < trackingEvents.length; i++){
				if( eventName == trackingEvents[ i ].eventName ){
					mw.log("KAdPlayer:: sendBeacon: " + eventName + ' to: ' + trackingEvents[ i ].beaconUrl );
					mw.sendBeaconUrl( trackingEvents[ i ].beaconUrl );
				};
			};				
		};
		
		// On end stop monitor / clear interval: 
		$( videoPlayer ).bind('ended' + bindPostfix, function(){			
			sendBeacon( 'complete' );
			// stop monitor
			clearInterval( _this.adMonitorInterval );
			// clear any bindings 
			$( videoPlayer).unbind( bindPostfix );
		});
		
		// On pause / resume: 
		$( videoPlayer ).bind( 'onpause' + bindPostfix, function(){
			sendBeacon( 'pause', true );
		});
		
		// On resume: 
		$( videoPlayer ).bind( 'onplay' + bindPostfix, function(){
			sendBeacon( 'resume', true );
		});
		
		var time = 0;
		// On seek backwards 
		$( videoPlayer ).bind( 'seek' + bindPostfix, function(){
			if( videoPlayer.currentTime < time ){
				sendBeacon( 'rewind' );
			}
		});		

		// Set up a monitor for time events: 
		this.adMonitorInterval = setInterval( function(){
			// check that the video player is still available: 
			if( !videoPlayer ){
				clearInterval( _this.adMonitorInterval );
			}
			time =  videoPlayer.currentTime;
			dur = videoPlayer.duration;
			
			if( time > 0 )
				sendBeacon( 'start' );
				
			if( time > dur / 4 )
				sendBeacon( 'firstQuartile' );
			
			if( time > dur / 2 )
				sendBeacon( 'midpoint' );
			
			if( time > dur / 1.5 )
				sendBeacon( 'thirdQuartile' );
			
		}, mw.getConfig('EmbedPlayer.MonitorRate') );		
	},
	/**
	 * Select a random element from the array and return it 
	 */
	selectFromArray: function( array ){
		return array[ Math.floor( Math.random() * array.length ) ];
	},
	playVideoSibling: function( src, playingCallback, doneCallback ){
		var _this = this;
		// Hide any loading spinner
		this.embedPlayer.hidePlayerSpinner();
		
		// include a timeout for the pause event to propagate
		setTimeout(function(){
			// make sure the embed player is "paused" 
			_this.getNativePlayerElement().pause();
			
			// put the player into "ad mode" 
			_this.embedPlayer.adTimeline.updateUiForAdPlayback();
			
			// Hide the current video:
			$( _this.getNativePlayerElement() ).hide();
			
			var vid = _this.getVideoAdSiblingElement();
			vid.src = src;
			vid.load();
			vid.play();
			
			if( playingCallback ){
				playingCallback( vid );
			}
			if( doneCallback ){
				$( vid ).bind('ended', function(){
					doneCallback();
				})
			}
			
		},0);
	},
	restoreEmbedPlayer:function(){
		// remove the video sibling: 
		$( '#' + this.getVideoAdSiblingId() ).remove();
		// show the player: 
		$( this.getNativePlayerElement() ).show();
	},
	getVideoAdSiblingElement: function(){
		var $vidSibling = $( '#' + this.getVideoAdSiblingId() );
		if( !$vidSibling.length ){			
			// check z-index of native player (if set ) 
			var zIndex = $( this.getNativePlayerElement() ).css('zindex');
			if( !zIndex ){
				$( this.getNativePlayerElement() ).css('z-index', 1 );
			}
			$vidSibling = $('<video />')
			.attr({
				'id' : this.getVideoAdSiblingId()
			})
			.css({
				'-webkit-transform-style': 'preserve-3d',
				'width' : '100%',
				'height': '100%'
			})
			$( this.embedPlayer ).append(
				$vidSibling
			);
		}
		return $vidSibling.get(0);
	},
	getVideoAdSiblingId: function(){
		return this.embedPlayer.pid + '_adSibling';
	},
	getNativePlayerElement: function(){
		return this.embedPlayer.getPlayerElement();
	}
}


} )( window.mw, window.jQuery );

	