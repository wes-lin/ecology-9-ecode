(function(){
  if (window.location.pathname === '/spa/custom/static4mobile/index.html') {
    var reg = /(\w|\d){32}_[^/]+/;
    window.addEventListener("hashchange", function(e) {
      var newURL = e.newURL;
      var oldURL = e.oldURL;
      var newMatch = newURL.match(reg);
      var oldMatch = oldURL.match(reg);
      if (newMatch && newMatch && newMatch[0] !== oldMatch[0]) {
        setTimeout(function() { window.onWeaverMobileLoad() }, 0);
      }
    });
  }
  if (window.ecodeSDK||!window.csInitIsLoad) { //ecodeSDK加载过或者config还在缓存状态没标记的情况
    return ;
  }
  var str = '';
  if (!window.localStorage.ecodeStaticCache || (window.localStorage.ecodeStaticCache && window.localStorage.ecodeStaticCache === "y")) {
    if (window.localStorage['ecodeStaticCacheVersion'] && window.localStorage['ecodeStaticCacheVersion'] !== "undefined") {
      str = "?v=" + window.localStorage['ecodeStaticCacheVersion'];
    } else {
      str = "?v=" + Math.random().toString().slice(-6);
    }
  }

  function _instanceof(left, right) { if (right != null && typeof Symbol !== "undefined" && right[Symbol.hasInstance]) { return !!right[Symbol.hasInstance](left); } else { return left instanceof right; } }

  window.ecodeSDK = {
    isIE: function() {
      return (!!window.ActiveXObject || "ActiveXObject" in window);
    },
    load: function (params) {
      var id = params.id;
      var noCss = params.noCss;
      if (ecodeSDK.isIE() && noCss !== false) { 
        noCss = true;
      }
      var tail = str;
      var arr = ['/cloudstore/release/' + id + '/index.js' + tail];
      if (window.ecologyContentPath) {
        arr = [window.ecologyContentPath + '/cloudstore/release/' + id + '/index.js' + tail];
      } 
      if (!noCss) {
        if (window.ecologyContentPath) {
          arr.push('css!' + window.ecologyContentPath + '/cloudstore/release/' + id + '/index.css' + tail);
        } else {
          arr.push('css!/cloudstore/release/' + id + '/index.css' + tail);
        }
      }
      // if(ecodeSDK.isIE()) {
      //   if (!ecodeSDK.loadjs.isDefined(id)) {
      //     ecodeSDK.loadjs(arr, id, {
      //       success:function () {
      //         typeof params.cb === 'function' && params.cb();
      //       },
      //       error: function () {
      //         if (!noCss) {
      //           typeof params.cb === 'function' && params.cb();
      //         }
      //       }
      //     });
      //   } else {
      //     typeof params.cb === 'function' && params.cb();
      //   }
      // }
      // else {
      if (!ecodeSDK.loadjs.isDefined(id)) {
        ecodeSDK.loadjs(arr, id);
      }
      ecodeSDK.loadjs.ready(id, params.cb);
      // }
    },
    render: function (params) {
      var domId = params.domId;
      var id = params.id;
      var name = params.name;
      var props = params.props;
      var noCss = params.noCss;
      ecodeSDK.load({
        id:id,
        noCss:noCss,
        cb:function () {
          var Com = ecodeSDK.getCom(id, name);
          ReactDOM.render(React.createElement(Com, props), document.getElementById(domId), params.cb);
        }
      });
    },
    comMap: {},
    setCom:function(id, name, Com) {
      if (!this.comMap[id]) this.comMap[id] = {};
      this.comMap[id][name] = Com;
    },
    getCom:function(id, name) {
      if (!this.comMap[id]) this.comMap[id] = {};
      return this.comMap[id][name];
    },
    getAsyncCom:function(params) {

      function _instanceof(left, right) { if (right != null && typeof Symbol !== "undefined" && right[Symbol.hasInstance]) { return !!right[Symbol.hasInstance](left); } else { return left instanceof right; } }

      function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

      function _extends() { _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }

      function _classCallCheck(instance, Constructor) { if (!_instanceof(instance, Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

      function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

      function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

      function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

      function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

      function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

      function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

      function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

      var _mobxReact = mobxReact,
          observer = _mobxReact.observer;
      var newProps = params.props || {};
      newProps.params = params.params;
      newProps.noCss = params.noCss;
      newProps.isPage = params.isPage;
      newProps.comId = params.name;
      newProps.moduleId = params.appId;
      var Async___Com = ecodeSDK.getCom(newProps.moduleId, newProps.comId + 'Async___Com');

      if (!Async___Com) {
        var _class;

        var AsyncCom = observer(_class =
            /*#__PURE__*/
            function (_React$Component) {
              _inherits(AsyncCom, _React$Component);

              function AsyncCom(props) {
                var _this;

                _classCallCheck(this, AsyncCom);

                _this = _possibleConstructorReturn(this, _getPrototypeOf(AsyncCom).call(this, props));
                var moduleId = props.moduleId,
                    comId = props.comId;
                _this.state = {
                  isLoad: false,
                  Com: null,
                  moduleId: moduleId,
                  comId: comId
                };
                return _this;
              }

              _createClass(AsyncCom, [{
                key: "getSnapshotBeforeUpdate",
                value: function getSnapshotBeforeUpdate(prevProps, prevState) {
                  var _this2 = this;

                  if (prevProps.moduleId !== this.props.moduleId || prevProps.comId !== this.props.comId) {
                    var _this$props = this.props,
                        moduleId = _this$props.moduleId,
                        comId = _this$props.comId;
                    this.setState({
                      isLoad: false,
                      moduleId: moduleId,
                      comId: comId,
                      Com: null
                    }, function () {
                      _this2.doLoad();
                    });
                  }
                }
              }, {
                key: "doLoad",
                value: function doLoad() {
                  var _this3 = this;

                  var _this$state = this.state,
                      isLoad = _this$state.isLoad,
                      moduleId = _this$state.moduleId,
                      comId = _this$state.comId;
                  var noCss = this.props.noCss;

                  if (!isLoad) {
                    ecodeSDK.load({
                      id: moduleId,
                      noCss: noCss,
                      cb: function cb() {
                        var Com = ecodeSDK.getCom(moduleId, comId);

                        if (Com != null) {
                          _this3.setState({
                            isLoad: true,
                            Com: Com
                          });
                        }
                      }
                    });
                  }
                }
              }, {
                key: "componentDidMount",
                value: function componentDidMount() {
                  this.doLoad();
                }
              }, {
                key: "render",
                value: function render() {
                  var _this$state2 = this.state,
                      isLoad = _this$state2.isLoad,
                      Com = _this$state2.Com,
                      moduleId = _this$state2.moduleId,
                      comId = _this$state2.comId;
                  if (!isLoad || moduleId !== this.props.moduleId || comId !== this.props.comId) return React.createElement("div", null);
                  return React.createElement(Com, _extends({}, this.props, this.state));
                }
              }]);

              return AsyncCom;
            }(React.Component)) || _class;

        Async___Com = AsyncCom;
        ecodeSDK.setCom(newProps.moduleId, newProps.comId + 'Async___Com', Async___Com);
      }

      if (newProps.isPage) {
        var Async___ComRoot = ecodeSDK.getCom(newProps.moduleId, newProps.comId + 'Async___ComRoot');

        if (!Async___ComRoot) {
          var _class2;

          var AsyncComRoot = observer(_class2 =
              /*#__PURE__*/
              function (_React$Component2) {
                _inherits(AsyncComRoot, _React$Component2);

                function AsyncComRoot() {
                  _classCallCheck(this, AsyncComRoot);

                  return _possibleConstructorReturn(this, _getPrototypeOf(AsyncComRoot).apply(this, arguments));
                }

                _createClass(AsyncComRoot, [{
                  key: "render",
                  value: function render() {
                    return React.createElement(Async___Com, _extends({}, this.props, newProps));
                  }
                }]);

                return AsyncComRoot;
              }(React.Component)) || _class2;

          Async___ComRoot = AsyncComRoot;
          ecodeSDK.setCom(newProps.moduleId, newProps.comId + 'Async___ComRoot', Async___ComRoot);
        }
        return Async___ComRoot;
      }
      return React.createElement(Async___Com, newProps);
    },
    rewritePortalLoginQueue: [],
    rewritePortalThemeQueue: [],
    rewritePortalCusEleQueue: [],
    rewritePortalCusEleHeaderQueue: [],
    rewritePortalCusEleToolbarQueue: [],
    rewritePortalCusEleTabQueue: [],
    rewritePortalCusEleSettingQueue: [],
    rewriteRouteQueue: [],
    rewriteMobileRouteQueue: [],
    onWeaverMobileLoadQueue: [],
    checkPath:function(params) {
      var path = params.path;
      var appId = params.appId;
      var name = params.name;
      var node = params.node;
      var Route = params.Route;
      var nextState = params.nextState;
      if (!Route) return false;
      if (!Route.location) return false;
      if (!nextState) return false;
      var _path = Route.location.pathname;
      var _node = nextState.path;
      return (path + "/" + appId+"_"+name) == _path && (node == _node||node+"/:uuid" == _node);
    },
    checkMobilePath:function(params) {
      var path = params.path;
      var appId = params.appId;
      var name = params.name;
      var props = params.props;
      var state = params.state;
      if (!props) return false;
      if (!state) return false;
      if (!state.match) return false;
      var _path = props.path;
      var _appId = state.match.params.uuid;
      return _path == path && _appId == appId+"_"+name;
    },
    imp:function(obj) {
      return obj;
    },
    exp:function() {

    },
    ecodeQueueSort:function(arr) {
      var len = arr.length;
      for (var i = 0; i < len; i++) {
        for (var j = 0; j < len - 1 - i; j++) {
          if (arr[j].order > arr[j+1].order) {
            var temp = arr[j+1];
            arr[j+1] = arr[j];
            arr[j] = temp;
          }
        }
      }
      return arr;
    },
    overwritePropsFnQueueMap: {},
    overwritePropsFnQueueInit: function() {
      if(!window.pcComponentsConfig) window.pcComponentsConfig = {};
      var map = ecodeSDK.overwritePropsFnQueueMap;
      for(k in map) {
        if(!window.pcComponentsConfig[k]) window.pcComponentsConfig[k] = {};
        window.pcComponentsConfig[k]['overwritePropsFn'] = function (newProps,name) {
          var objMap = map[name];
          if(objMap&&objMap.queue) {
            var arr = objMap.queue;
            arr = ecodeSDK.ecodeQueueSort(arr);
            for (var j = 0; j < arr.length; j++) {
              var obj = arr[j];
              if (obj && typeof obj.fn == "function") {
                var result = obj.fn(newProps,name);
                if(result) {
                  newProps = result;
                }
              }
            }
            return newProps;
          }
        }
      }
    },
    overwritePropsFnQueueMapSet:function (k,v) {
      if(!ecodeSDK.overwritePropsFnQueueMap[k])
        ecodeSDK.overwritePropsFnQueueMap[k] = {queue:[]};
      var map = ecodeSDK.overwritePropsFnQueueMap[k];
      map.queue.push(v);
      ecodeSDK.overwritePropsFnQueueMap[k] = map;
      ecodeSDK.overwritePropsFnQueueInit();
    },
    overwriteClassFnQueueMap: {},
    overwriteClassFnQueueInit: function() {
      if(!window.pcComponentsConfig) window.pcComponentsConfig = {};
      var map = ecodeSDK.overwriteClassFnQueueMap;
      for(k in map) {
        if(!window.pcComponentsConfig[k]) window.pcComponentsConfig[k] = {};
        window.pcComponentsConfig[k]['overwriteClassFn'] = function (Com, newProps, name) {
          var objMap = map[name];
          if(objMap&&objMap.queue) {
            var arr = objMap.queue;
            arr = ecodeSDK.ecodeQueueSort(arr);
            var newResult = {
              com:Com,
              props:newProps
            };
            for (var j = 0; j < arr.length; j++) {
              var obj = arr[j];
              if (obj && typeof obj.fn == "function") {
                var result = obj.fn(Com, newProps, name);
                if (result) {
                  newResult = result;
                }
              }
            }
            return newResult;
          }
        }
      }
    },
    overwriteClassFnQueueMapSet:function (k,v) {
      if(!ecodeSDK.overwriteClassFnQueueMap[k])
        ecodeSDK.overwriteClassFnQueueMap[k] = {queue:[]};
      var map = ecodeSDK.overwriteClassFnQueueMap[k];
      map.queue.push(v);
      ecodeSDK.overwriteClassFnQueueMap[k] = map;
      ecodeSDK.overwriteClassFnQueueInit();
    },
    overwriteMobilePropsFnQueueMap: {},
    overwriteMobilePropsFnQueueInit: function() {
      if(!window.mobileComponentsConfig) window.mobileComponentsConfig = {};
      var map = ecodeSDK.overwriteMobilePropsFnQueueMap;
      for(k in map) {
        if(!window.mobileComponentsConfig[k]) window.mobileComponentsConfig[k] = {};
        window.mobileComponentsConfig[k]['overwritePropsFn'] = function (newProps,name) {
          name = name==""?k:name;
          var objMap = map[name];
          if(objMap&&objMap.queue) {
            var arr = objMap.queue;
            arr = ecodeSDK.ecodeQueueSort(arr);
            for (var j = 0; j < arr.length; j++) {
              var obj = arr[j];
              if (obj && typeof obj.fn == "function") {
                var result = obj.fn(newProps,name);
                if(result) {
                  newProps = result;
                }
              }
            }
            return newProps;
          }
        }
      }
    },
    overwriteMobilePropsFnQueueMapSet:function (k,v) {
      if(!ecodeSDK.overwriteMobilePropsFnQueueMap[k])
        ecodeSDK.overwriteMobilePropsFnQueueMap[k] = {queue:[]};
      var map = ecodeSDK.overwriteMobilePropsFnQueueMap[k];
      map.queue.push(v);
      ecodeSDK.overwriteMobilePropsFnQueueMap[k] = map;
      ecodeSDK.overwriteMobilePropsFnQueueInit();
    },
    overwriteMobileClassFnQueueMap: {},
    overwriteMobileClassFnQueueInit: function() {
      if(!window.mobileComponentsConfig) window.mobileComponentsConfig = {};
      var map = ecodeSDK.overwriteMobileClassFnQueueMap;
      for(k in map) {
        if(!window.mobileComponentsConfig[k]) window.mobileComponentsConfig[k] = {};
        window.mobileComponentsConfig[k]['overwriteClassFn'] = function (Com,newProps,name) {
          name = name==""?k:name;
          var objMap = map[name];
          if(objMap&&objMap.queue) {
            var newResult = {
              com:Com,
              props:newProps
            };
            var arr = objMap.queue;
            arr = ecodeSDK.ecodeQueueSort(arr);
            for (var j = 0; j < arr.length; j++) {
              var obj = arr[j];
              if (obj && typeof obj.fn == "function") {
                var result = obj.fn(Com,newProps,name);
                if(result) {
                  newResult = result;
                }
              }
            }
            return newResult;
          }
        }
      }
    },
    overwriteMobileClassFnQueueMapSet:function (k,v) {
      if(!ecodeSDK.overwriteMobileClassFnQueueMap[k])
        ecodeSDK.overwriteMobileClassFnQueueMap[k] = {queue:[]};
      var map = ecodeSDK.overwriteMobileClassFnQueueMap[k];
      map.queue.push(v);
      ecodeSDK.overwriteMobileClassFnQueueMap[k] = map;
      ecodeSDK.overwriteMobileClassFnQueueInit();
    },
    checkLPath:function(url) {
      var pathname = window.location.pathname;
      var hash = window.location.hash;
      return (pathname+hash).indexOf(url)==0&&url!="";
    },
    findPropData:function(props, key) {
      var value = '';

      if (props && props.children && _instanceof(props.children, Array)) {
        for (var i = 0; i < props.children.length && value === ''; i++) {
          var tmpValue = ecodeSDK.findPropData(props.children[i].props, key);

          if (tmpValue && tmpValue !== '') {
            value = tmpValue;
          }
        }
      } else if (props && props.children && _instanceof(props.children, Object)) {
        var _tmpValue = ecodeSDK.findPropData(props.children.props, key);

        if (_tmpValue && _tmpValue !== '') {
          value = _tmpValue;
        }
      } else if (props && props[key]) {
        var _tmpValue2 = props[key];

        if (_tmpValue2 && _tmpValue2 !== '') {
          value = _tmpValue2;
        }
      }

      return value;
    },
    rewriteApiDataQueue: null,
    rewriteApiDataQueueInit: function() {
      window.rewriteApiData = function (_url, params, data) {
        var res = null;
        for (var i = 0; i< ecodeSDK.rewriteApiDataQueue.length; i++) {
          res = ecodeSDK.rewriteApiDataQueue[i].fn(_url, params, res || data);
        }
        return res || data;
      }
    },
    rewriteApiDataQueueSet: function(v) {
      if (v && typeof v.fn === 'function') {
        if (!ecodeSDK.rewriteApiDataQueue) ecodeSDK.rewriteApiDataQueue = [];
        ecodeSDK.rewriteApiDataQueue.push(v);
        ecodeSDK.rewriteApiDataQueueInit();
      }
    },
    rewriteApiParamsQueue: null,
    rewriteApiParamsQueueInit: function() {
      if (!window.e9ssoPCConfig) {
        window.e9ssoPCConfig = {
          inUse: true,
          callapi_params_handler: null,
        }
      }
      window.e9ssoPCConfig.callapi_params_handler = function (
          _url,
          method,
          params,
          type,
          _fetchParams
      ) {
        var res = {};
        var resAll = {};
        function getFd(values, deep) {
          var fd = "";
          for (var p in values) {
            var target = values[p];
            if (typeof target === "function") {
              continue;
            }
            if (deep && typeof target === "object") {
              fd += getFd(target, deep);
            } else if (p == "jsonstr" && typeof target === "object") {
              var item = JSON.stringify(target);
              fd += p + "=" + item.replace(/\\/g, "") + "&";
            } else {
              // 处理undefined null数据to 空串
              target = target == undefined ? "" : target;
              var item = encodeURIComponent(target);
              fd += p + "=" + item + "&";
            }
          }
          return fd;
        };
        for (var i = 0; i< ecodeSDK.rewriteApiParamsQueue.length; i++) {
          res = ecodeSDK.rewriteApiParamsQueue[i].fn.fn(
            (resAll[_url] && resAll[_url].url) || _url,
            (resAll[_url] && resAll[_url].method) || method,
            (resAll[_url] && resAll[_url].params) || params,
            (resAll[_url] && resAll[_url].type) || type,
            (resAll[_url] && resAll[_url].fetchParams) || _fetchParams
          );
          resAll[_url] = res;
        }
        var resultParams = res || {};
        if(resultParams.fetchParams) {
          var clonefetchParams = resultParams.fetchParams.params || {};
          if ((JSON.stringify(clonefetchParams) != "{}") && method.toUpperCase() !== "GET") {
            resultParams.fetchParams.body = getFd(clonefetchParams, false);
          }
        }
        var result = {
          url: resultParams.url || _url,
          method: resultParams.method || method,
          params: resultParams.params || params,
          type: resultParams.type || type,
          fetchParams: resultParams.fetchParams,
        };
        return result;
      }
    },
    rewriteApiParamsQueueSet: function(v, order) {
      if (v && typeof v.fn === 'function') {
        if (!ecodeSDK.rewriteApiParamsQueue) {
          ecodeSDK.rewriteApiParamsQueue = [];
        }
        ecodeSDK.rewriteApiParamsQueue.push({
          fn: v,
          order: order || 1,
        });
        ecodeSDK.rewriteApiParamsQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewriteApiParamsQueue);
        ecodeSDK.rewriteApiParamsQueueInit();
      }
    },
    rewriteMobileApiParamsQueue: null,
    rewriteMobileApiParamsQueueInit: function() {
      if (!window.e9ssoMobileConfig) {
        window.e9ssoMobileConfig = {
          inUse: true,
          callapi_params_handler: null,
          customInit: function () {
            return new Promise(function (resolve) {resolve();});
          }
        }
      }
      window.e9ssoMobileConfig.callapi_params_handler = function (
          _url, method, params, includeCredentials, useJson, _fetchParams
      ) {
        var res = {};
        var resAll = {};
        for (var i = 0; i< ecodeSDK.rewriteMobileApiParamsQueue.length; i++) {
          res = ecodeSDK.rewriteMobileApiParamsQueue[i].fn.fn(
            (resAll[_url] && resAll[_url].url) || _url,
            (resAll[_url] && resAll[_url].method) || method,
            (resAll[_url] && resAll[_url].params) || params,
            (resAll[_url] && resAll[_url].includeCredentials) || includeCredentials,
            (resAll[_url] && resAll[_url].useJson) || useJson,
            (resAll[_url] && resAll[_url].fetchParams) || _fetchParams
          );
          resAll[_url] = res;
        }
        var resultParams = res || {};
        var result = {
          url: resultParams.url || _url,
          method: resultParams.method || method,
          params: resultParams.params || params,
          includeCredentials: resultParams.includeCredentials || includeCredentials,
          useJson: resultParams.useJson || useJson,
          fetchParams: resultParams.fetchParams,
        };
        return result;
      }
    },
    rewriteMobileApiParamsQueueSet: function(v, order) {
      if (v && typeof v.fn === 'function') {
        if (!ecodeSDK.rewriteMobileApiParamsQueue) {
          ecodeSDK.rewriteMobileApiParamsQueue = [];
        }
        ecodeSDK.rewriteMobileApiParamsQueue.push({
          fn: v,
          order: order || 1,
        });
        ecodeSDK.rewriteMobileApiParamsQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewriteMobileApiParamsQueue);
        ecodeSDK.rewriteMobileApiParamsQueueInit();
      }
    },
    getJSONObj: function(key) {
      if (!window.localStorage[key]) return null;
      try {
          return JSON.parse(window.localStorage[key]);
      }
      catch(e) {
        return {}
      }
    },
    getEcodeParams: function(keys) {
      if (keys && keys instanceof Array) {
        var len = keys.length;
        var result = '';
        for(var i=0; i < len; i++) {
          var key = keys[i];
          if (key && i === 0) {
            result = ecodeSDK.getJSONObj(keys[i]);
          } else if (key && result && result[key]) {
            result = result[key] || '';
          }
        }
        return result;
      }
      return '';
    }
  }

  ecodeSDK.overwritePropsFnQueueInit();

  ecodeSDK.overwriteClassFnQueueInit();

  ecodeSDK.overwriteMobilePropsFnQueueInit();

  ecodeSDK.overwriteMobileClassFnQueueInit();

  window.onWeaverMobileLoad = function () {
    for (var i = 0; i < ecodeSDK.onWeaverMobileLoadQueue.length; i++) {
      var fn = ecodeSDK.onWeaverMobileLoadQueue[i];
      if (typeof fn == "function") {
        fn();
      }
    }
  }
  window.rewriteRoute = function (Com, Route, nextState) {
    var NewCom = null;
    ecodeSDK.rewriteRouteQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewriteRouteQueue);
    for (var i = 0; i < ecodeSDK.rewriteRouteQueue.length&&NewCom==null; i++) {
      var obj = ecodeSDK.rewriteRouteQueue[i];
      if (obj && typeof obj.fn == "function") {
        var ThisCom = obj.fn({Com:Com, Route:Route, nextState:nextState});
        if (ThisCom != null) {
          NewCom = ThisCom;
        }
      }
    }
    return NewCom==null?Com:NewCom;
  };
  window.rewriteMobileRoute = function (Com, props, state, context) {
    ecodeSDK.rewriteMobileRouteQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewriteMobileRouteQueue);
    for (var i = 0; i < ecodeSDK.rewriteMobileRouteQueue.length; i++) {
      var obj = ecodeSDK.rewriteMobileRouteQueue[i];
      if (obj && typeof obj.fn == "function") {
        var ThisCom = obj.fn({Com:Com, props:props, state:state, context:context},props);
        if (ThisCom != null) Com = ThisCom;
      }
    }
    return Com;
  }
  window.rewritePortalCusEleSetting = function (props, options) {
    ecodeSDK.rewritePortalCusEleSettingQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewritePortalCusEleSettingQueue);
    var Com = null;
    for (var i = 0; i < ecodeSDK.rewritePortalCusEleSettingQueue.length; i++) {
      var obj = ecodeSDK.rewritePortalCusEleSettingQueue[i];
      if (obj && typeof obj.fn == "function") {
        var ThisCom = obj.fn({props:props, options:options});
        if (ThisCom != null) Com = ThisCom;
      }
    }
    return Com;
  }
  window.rewritePortalCusEle = function (props, options) {
    ecodeSDK.rewritePortalCusEleQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewritePortalCusEleQueue);
    var Com = null;
    for (var i = 0; i < ecodeSDK.rewritePortalCusEleQueue.length; i++) {
      var obj = ecodeSDK.rewritePortalCusEleQueue[i];
      if (obj && typeof obj.fn == "function") {
        var ThisCom = obj.fn({props:props, options:options});
        if (ThisCom != null) Com = ThisCom;
      }
    }
    return Com;
  }
  window.rewritePortalLogin = function (props, options) {
    ecodeSDK.rewritePortalLoginQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewritePortalLoginQueue);
    var Com = null;
    for (var i = 0; i < ecodeSDK.rewritePortalLoginQueue.length; i++) {
      var obj = ecodeSDK.rewritePortalLoginQueue[i];
      if (obj && typeof obj.fn == "function") {
        var ThisCom = obj.fn({props:props, options:options});
        if (ThisCom != null) Com = ThisCom;
      }
    }
    return Com;
  }
  window.rewritePortalTheme = function (props, options) {
    ecodeSDK.rewritePortalThemeQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewritePortalThemeQueue);
    var Com = null;
    for (var i = 0; i < ecodeSDK.rewritePortalThemeQueue.length; i++) {
      var obj = ecodeSDK.rewritePortalThemeQueue[i];
      if (obj && typeof obj.fn == "function") {
        var ThisCom = obj.fn({props:props, options:options});
        if (ThisCom != null) Com = ThisCom;
      }
    }
    return Com;
  }
  window.rewritePortalEleHeader = function (props, options) {
    ecodeSDK.rewritePortalCusEleHeaderQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewritePortalCusEleHeaderQueue);
    var Com = null;
    for (var i = 0; i < ecodeSDK.rewritePortalCusEleHeaderQueue.length; i++) {
      var obj = ecodeSDK.rewritePortalCusEleHeaderQueue[i];
      if (obj && typeof obj.fn == "function") {
        var ThisCom = obj.fn({props:props, options:options});
        if (ThisCom != null) Com = ThisCom;
      }
    }
    return Com;
  }
  window.rewritePortalEleToolbar = function (props, options) {
    ecodeSDK.rewritePortalCusEleToolbarQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewritePortalCusEleToolbarQueue);
    var Com = null;
    for (var i = 0; i < ecodeSDK.rewritePortalCusEleToolbarQueue.length; i++) {
      var obj = ecodeSDK.rewritePortalCusEleToolbarQueue[i];
      if (obj && typeof obj.fn == "function") {
        var ThisCom = obj.fn({props:props, options:options});
        if (ThisCom != null) Com = ThisCom;
      }
    }
    return Com;
  }
  window.rewritePortalEleTab = function (props, options) {
    ecodeSDK.rewritePortalCusEleTabQueue = ecodeSDK.ecodeQueueSort(ecodeSDK.rewritePortalCusEleTabQueue);
    var Com = null;
    for (var i = 0; i < ecodeSDK.rewritePortalCusEleTabQueue.length; i++) {
      var obj = ecodeSDK.rewritePortalCusEleTabQueue[i];
      if (obj && typeof obj.fn == "function") {
        var ThisCom = obj.fn({props:props, options:options});
        if (ThisCom != null) Com = ThisCom;
      }
    }
    return Com;
  }
  ecodeSDK.loadjs = function () {
    var a = function () {
    }, c = {}, u = {}, f = {};

    function o(e, n) {
      if (e) {
        var t = f[e];
        if (u[e] = n, t) for (; t.length;) t[0](e, n), t.splice(0, 1)
      }
    }

    function l(e, n) {
      e.call && (e = {success: e}), n.length ? (e.error || a)(n) : (e.success || a)(e)
    }

    function h(t, r, s, i) {
      var c, o, e = document, n = s.async, u = (s.numRetries || 0) + 1, f = s.before || a,
          l = t.replace(/^(css|img)!/, "");
      i = i || 0, /(^css!|\.css$)/.test(t) ? ((o = e.createElement("link")).rel = "stylesheet", o.href = l, (c = "hideFocus" in o) && o.relList && (c = 0, o.rel = "preload", o.as = "style")) : /(^img!|\.(png|gif|jpg|svg)$)/.test(t) ? (o = e.createElement("img")).src = l : ((o = e.createElement("script")).src = t, o.async = void 0 === n || n), !(o.onload = o.onerror = o.onbeforeload = function (e) {
        var n = e.type[0];
        if (c) try {
          o.sheet.cssText.length || (n = "e")
        } catch (e) {
          18 != e.code && (n = "e")
        }
        if ("e" == n) {
          if ((i += 1) < u) return h(t, r, s, i)
        } else if ("preload" == o.rel && "style" == o.as) return o.rel = "stylesheet";
        r(t, n, e.defaultPrevented)
      }) !== f(t, o) && e.head.appendChild(o)
    }

    function t(e, n, t) {
      var r, s;
      if (n && n.trim && (r = n), s = (r ? t : n) || {}, r) {
        if (r in c) throw"LoadJS";
        c[r] = !0
      }

      function i(n, t) {
        !function (e, r, n) {
          var t, s, i = (e = e.push ? e : [e]).length, c = i, o = [];
          for (t = function (e, n, t) {
            if ("e" == n && o.push(e), "b" == n) {
              if (!t) return;
              o.push(e)
            }
            --i || r(o)
          }, s = 0; s < c; s++) h(e[s], t, n)
        }(e, function (e) {
          l(s, e), n && l({success: n, error: t}, e), o(r, e)
        }, s)
      }

      if (s.returnPromise) return new Promise(i);
      i()
    }

    return t.ready = function (e, n) {
      return function (e, t) {
        e = e.push ? e : [e];
        var n, r, s, i = [], c = e.length, o = c;
        for (n = function (e, n) {
          n.length && i.push(e), --o || t(i)
        }; c--;) r = e[c], (s = u[r]) ? n(r, s) : (f[r] = f[r] || []).push(n)
      }(e, function (e) {
        l(n, e)
      }), t
    }, t.done = function (e) {
      o(e, [])
    }, t.reset = function () {
      c = {}, u = {}, f = {}
    }, t.isDefined = function (e) {
      return e in c
    }, t
  }();
})();
