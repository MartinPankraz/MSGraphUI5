sap.ui.define([
	"./BaseController",
	"sap/ui/model/json/JSONModel",
	"../model/formatter",
	"sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "azure/graph/example/msgraphui/libs/msal"
], function (BaseController, JSONModel, formatter, Filter, FilterOperator, MessageToast, msal) {
	"use strict";

	return BaseController.extend("azure.graph.example.msgraphui.controller.Worklist", {

        formatter: formatter,
        
        /* =========================================================== */
		/* AAD MSAL setup
		/* =========================================================== */

        config: {
            msalConfig: {
                auth: {
                    clientId: "<<your AAD app registration client id>>"
                },
                cache: {
                    cacheLocation: 'localStorage',
                    storeAuthStateInCookie: true
                }
            },
            graphBaseEndpoint: "https://graph.microsoft.com/v1.0/",
            userInfoSuffix: "me/",
            queryMessagesSuffix: "me/messages?$search=\"$1\"&$top=150",
            scopeConfig: {
                scopes: ['User.Read', 'Mail.Read']
            }
        },

		/* =========================================================== */
		/* lifecycle methods                                           */
		/* =========================================================== */

		/**
		 * Called when the worklist controller is instantiated.
		 * @public
		 */
		onInit : function () {
            var that = this;
            this.myMSALAccessToken = "none";
            this.oMsalClient = new Msal.UserAgentApplication(this.config.msalConfig);
            if (!this.oMsalClient.getAccount()) {
                this.oMsalClient.loginPopup(this.config.scopeConfig).then(this.fetchUserInfo.bind(this));
            } else {
                this.fetchUserInfo();
            }

            var oViewModel,
                oSessionModel,
				iOriginalBusyDelay,
				oTable = this.byId("table");

			// Put down worklist table's original value for busy indicator delay,
			// so it can be restored later on. Busy handling on the table is
			// taken care of by the table itself.
			iOriginalBusyDelay = oTable.getBusyIndicatorDelay();
			// keeps the search state
			this._aTableSearchState = [];

			// Model used to manipulate control states
			oViewModel = new JSONModel({
				worklistTableTitle : this.getResourceBundle().getText("worklistTableTitle"),
				shareOnJamTitle: this.getResourceBundle().getText("worklistTitle"),
				shareSendEmailSubject: this.getResourceBundle().getText("shareSendEmailWorklistSubject"),
				shareSendEmailMessage: this.getResourceBundle().getText("shareSendEmailWorklistMessage", [location.href]),
				tableNoDataText : this.getResourceBundle().getText("tableNoDataText"),
				tableBusyDelay : 0
            });
            oSessionModel = new JSONModel({});
            this.setModel(oViewModel, "worklistView");
            this.setModel(oSessionModel, "session");

			// Make sure, busy indication is showing immediately so there is no
			// break after the busy indication for loading the view's meta data is
			// ended (see promise 'oWhenMetadataIsLoaded' in AppController)
			oTable.attachEventOnce("updateFinished", function(){
				// Restore original busy indicator delay for worklist's table
				oViewModel.setProperty("/tableBusyDelay", iOriginalBusyDelay);
            });
            
            this.getView().addEventDelegate({
                onBeforeHide: function(event) {
                const targetView = event.to;
                const dataToPass = that.myMSALAccessToken;
                targetView.data("data", dataToPass);
                }
            }, this);
		},

		/* =========================================================== */
		/* event handlers                                              */
		/* =========================================================== */

		/**
		 * Triggered by the table's 'updateFinished' event: after new table
		 * data is available, this handler method updates the table counter.
		 * This should only happen if the update was successful, which is
		 * why this handler is attached to 'updateFinished' and not to the
		 * table's list binding's 'dataReceived' method.
		 * @param {sap.ui.base.Event} oEvent the update finished event
		 * @public
		 */
		onUpdateFinished : function (oEvent) {
			// update the worklist's object counter after the table update
			var sTitle,
				oTable = oEvent.getSource(),
				iTotalItems = oEvent.getParameter("total");
			// only update the counter if the length is final and
			// the table is not empty
			if (iTotalItems && oTable.getBinding("items").isLengthFinal()) {
				sTitle = this.getResourceBundle().getText("worklistTableTitleCount", [iTotalItems]);
			} else {
				sTitle = this.getResourceBundle().getText("worklistTableTitle");
			}
			this.getModel("worklistView").setProperty("/worklistTableTitle", sTitle);
		},

		/**
		 * Event handler when a table item gets pressed
		 * @param {sap.ui.base.Event} oEvent the table selectionChange event
		 * @public
		 */
		onPress : function (oEvent) {
			// The source is the list item that got pressed
			this._showObject(oEvent.getSource());
		},

		/**
		 * Event handler for navigating back.
		 * We navigate back in the browser history
		 * @public
		 */
		onNavBack : function() {
			// eslint-disable-next-line sap-no-history-manipulation
			history.go(-1);
		},


		onSearch : function (oEvent) {
			if (oEvent.getParameters().refreshButtonPressed) {
				// Search field's 'refresh' button has been pressed.
				// This is visible if you select any master list item.
				// In this case no new search is triggered, we only
				// refresh the list binding.
				this.onRefresh();
			} else {
				var aTableSearchState = [];
				var sQuery = oEvent.getParameter("query");

				if (sQuery && sQuery.length > 0) {
					aTableSearchState = [new Filter("POId", FilterOperator.Contains, sQuery)];
				}
				this._applySearch(aTableSearchState);
			}
		},

		/**
		 * Event handler for refresh event. Keeps filter, sort
		 * and group settings and refreshes the list binding.
		 * @public
		 */
		onRefresh : function () {
			var oTable = this.byId("table");
			oTable.getBinding("items").refresh();
        },
        
        // Check if logged in to Azure Active Directory and call MSAL to clean up
        onLogout: function (oEvent) {
            var oSessionModel = oEvent.getSource().getModel('session');
            var bIsLoggedIn = oSessionModel.getProperty('/userPrincipalName');
            if (bIsLoggedIn) {
                this.oMsalClient.logout();
                return;
            }
            this.fetchUserInfo();
        },

        // Call Microsoft Graph API to get more information about the logged in user (Endpoint: userInfoSuffix -> /me) and place the information in the session Model for UI usage
        fetchUserInfo: function () {
            this.callGraphApi(this.config.graphBaseEndpoint + this.config.userInfoSuffix, function (response) {
                $.sap.log.info("Logged in successfully!", response);
                this.getView().getModel("session").setData(response);
            }.bind(this));
        },

        //Call a specific Microsoft Graph API endpoint asynchronously (Token Handling done by MSAL)
        callGraphApi: function (sEndpoint, fnCb) {
            var that = this;
            this.oMsalClient.acquireTokenSilent(this.config.scopeConfig)
                .then(function (token) {
                    that.myMSALAccessToken = token.accessToken;
                    $.ajax({
                        url: sEndpoint,
                        type: "GET",
                        beforeSend: function (xhr) {
                            xhr.setRequestHeader("Authorization", "Bearer " + that.myMSALAccessToken);
                        }
                    })
                    .then(fnCb)
                    .fail(function (error) {
                        MessageToast.show("Error, please check the log for details");
                        $.sap.log.error(JSON.stringify(error.responseJSON.error));
                    });
                }.bind(this));
        },

		/* =========================================================== */
		/* internal methods                                            */
		/* =========================================================== */

		/**
		 * Shows the selected item on the object page
		 * On phones a additional history entry is created
		 * @param {sap.m.ObjectListItem} oItem selected Item
		 * @private
		 */
		_showObject : function (oItem) {
			this.getRouter().navTo("object", {
				objectId: oItem.getBindingContext().getProperty("POId")
			});
		},

		/**
		 * Internal helper method to apply both filter and search state together on the list binding
		 * @param {sap.ui.model.Filter[]} aTableSearchState An array of filters for the search
		 * @private
		 */
		_applySearch: function(aTableSearchState) {
			var oTable = this.byId("table"),
				oViewModel = this.getModel("worklistView");
			oTable.getBinding("items").filter(aTableSearchState, "Application");
			// changes the noDataText of the list in case there are no filter results
			if (aTableSearchState.length !== 0) {
				oViewModel.setProperty("/tableNoDataText", this.getResourceBundle().getText("worklistNoDataWithSearchText"));
			}
		}

	});
});
