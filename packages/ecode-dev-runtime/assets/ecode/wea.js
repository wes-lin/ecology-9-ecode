(function(){
  if (!window.weaJs) {
    window.weaJs = {
      getFrameParams: function () {
        var url = window.location.href;
        var urlParams = url.slice(url.lastIndexOf('?') + 1).split('&');
        var params = {};
        // urlParams.forEach(element => {
        //   var datas = element.split('=');
        //   params[datas[0]] = datas[1];
        // });
        urlParams.forEach(function (element) {
          var datas = element.split('=');
          params[datas[0]] = datas[1];
        });
        return params;
      },
      callApi: function (options) {
        if (Object.prototype.toString.call(options) === '[object Object]') {
          if (window.sso_callApi) {
            // mobile
            return window.sso_callApi(options);
          } else if (window.ecCom && window.ecCom.WeaTools) {
            // pc
            var url = options.url || '';
            var method = options.method || 'GET';
            var params = options.params || {};
            var deep = options.deep || false;
            var checkCode = options.checkCode !== false;
            var type = options.type || 'json';
            return window.ecCom.WeaTools.callApi(url, method, params, type, deep, checkCode);
          }
        }
      },
      alert: function(content) {
        if (typeof content === 'string') {
          if (window.antd && window.antd.Modal) {
            // pc
            window.antd.Modal.info({ content: content });
          } else {
            // mobile 0601之后包会调用移动端组件
            window.alert(content);
          }
        }
      },
      showDialog: function(url, params) {
        if (window.ecCom && window.ecCom.WeaTools) {
          // pc
          var options = { url: url };
          if (Object.prototype.toString.call(params) === '[object Object]') {
            for (var key in params) {
              if (params.hasOwnProperty(key)) {
                options[key] = params[key];
              }
            }
          }
          var dialog = window.ecCom.WeaTools.createDialog(options);
          dialog.show();
          return dialog;
        } else {
          // mobile 0601之后包会调用移动端路由页面组件
          var frameView = window.document.createElement("div");
          var closeDom = window.document.createElement("div");
          frameView.style.position = "fixed";
          frameView.style.background = "#fff";
          frameView.style.width = "100%";
          frameView.style.height = "100%";
          frameView.style.top = 0;
          frameView.style.left = 0;
          frameView.style.zIndex = 998;
          frameView.innerHTML = '<iframe style="border:none;height:100%;width:100%" src="' + url + '"></iframe>';
          closeDom.className = 'wea-js-showDialog-close';

          if (!document.getElementById('weaJsShowDialogCloseStyle')) {
            var closeStyle = window.document.createElement("style");
            closeStyle.id = 'weaJsShowDialogCloseStyle';
            closeStyle.innerHTML = '.wea-js-showDialog-close{position:absolute;right:3px;top:3px;width:30px;height:30px;background:#ccc;opacity:.6;border-radius:50%;cursor:pointer}.wea-js-showDialog-close:hover{opacity:1}.wea-js-showDialog-close:after,.wea-js-showDialog-close:before{position:absolute;content:"";width:20px;height:4px;background:#fff;top:13px;left:5px;transform: rotate(-45deg);}.wea-js-showDialog-close:before{transform:rotate(45deg)}';
            window.document.head.appendChild(closeStyle);
          }
          window.document.body.appendChild(frameView);
          frameView.appendChild(closeDom);
          var result = {
            destory: function () {
              try {
                window.document.body.removeChild(frameView);
              } catch (error) {}
            }
          }
          closeDom.onclick = function(e) {
            result.destory();
            e.preventDefault();
          }
          return result;
        }
      },
      Custom: function() {

        function _instanceof(left, right) { if (right != null && typeof Symbol !== "undefined" && right[Symbol.hasInstance]) { return !!right[Symbol.hasInstance](left); } else { return left instanceof right; } }

        function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

        function _classCallCheck(instance, Constructor) { if (!_instanceof(instance, Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

        function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

        function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

        function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

        function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

        function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

        function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

        function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

        var WeaCustom =
        /*#__PURE__*/
        function (_React$Component) {
          _inherits(WeaCustom, _React$Component);

          function WeaCustom() {
            _classCallCheck(this, WeaCustom);

            return _possibleConstructorReturn(this, _getPrototypeOf(WeaCustom).apply(this, arguments));
          }

          _createClass(WeaCustom, [{
            key: "render",
            value: function render() {
              return this.props.children;
            }
          }]);

          return WeaCustom;
        }(React.Component);
        return WeaCustom;
      },
      Con: function() {

        function _instanceof(left, right) { if (right != null && typeof Symbol !== "undefined" && right[Symbol.hasInstance]) { return !!right[Symbol.hasInstance](left); } else { return left instanceof right; } }

        function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

        function _classCallCheck(instance, Constructor) { if (!_instanceof(instance, Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

        function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

        function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

        function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

        function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

        function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

        function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

        function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

        var WeaCon =
        /*#__PURE__*/
        function (_React$Component) {
          _inherits(WeaCon, _React$Component);

          function WeaCon() {
            _classCallCheck(this, WeaCon);

            return _possibleConstructorReturn(this, _getPrototypeOf(WeaCon).apply(this, arguments));
          }

          _createClass(WeaCon, [{
            key: "render",
            value: function render() {
              return this.props.children;
            }
          }]);

          return WeaCon;
        }(React.Component);
        return WeaCon;
      },
    };
  }
})();
