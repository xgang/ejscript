/**
    Router.es - Web Request router. Route incoming client HTTP requests.
 */

# Config.WEB
module ejs.web {

    /** 
        The Router class manages incoming HTTP requests to the appropriate location application for servicing. 
        The Route class supports configurable user-defined routes. Each application should create a Router 
        instance and then attach matching routes.

        The Router works by defining routes in a route table. For rapid routing, routes are grouped into sets of 
        routes with the same leading URI path segment. For example: the route template "/User/login" would be put into
        the "User" route set. If a route template is a function or regular expression, the route is added to the "Global"
        route set.
        
        The $ejs.web::Request.pathInfo and other Request properties are examined when selecting a matching route. 
        The request's leading URI pathInfo segment is used to select a route set and then the request is matched 
        against each route in that set. Routes are matched in the order in which they are defined.

        @example:
        var r = new Router
        
        //  Match /some/path and run myCustomApp to generate a response. 
        //  Target is data for myCustomApp.
        r.add("/some/path", {response: myCustomApp, target: "/other/path"})

        //  Match /User/register and run MvcApp with controller == User and 
        //  action == "register"
        r.add("\@/User/register")

        //  Add route for files with a ".es" extension and use the ScriptApp 
        //  to generate the response
        r.add(/\.es$/i, {response: ScriptApp})

        //  Add route for directories and use the DirApp to generate the response
        r.add(Router.isDir, {name: "dir", response: DirApp})

        //  Add routes for RESTful routes for URIs starting with "/User" and 
        //  respond using MvcApp
        r.addResources("User")

        //  Manually create restful routes using the given URI template patterns
        r.add("/{controller}",           {action: "create", method: "POST"})
        r.add("/{controller}/init",      {action: "init"})
        r.add("/{controller}",           {action: "index"})
        r.add("/{controller}/{id}/edit", {action: "edit"})
        r.add("/{controller}/{id}",      {action: "show"})
        r.add("/{controller}/{id}",      {action: "update", method: "PUT"})
        r.add("/{controller}/{id}",      {action: "destroy", method: "DELETE"})
        r.add("/{controller}(/do/{action})")
        
        //  Add route for upper or lower case "D" or "d". Run the default app: MvcApp, 
        //  Dash contoller, refresh action.
        r.add("/[Dd]ash/refresh", "\@Dash/refresh")

        //  Add route for an "admin" application. This sets the scriptName to "admin" 
        //  and expects an application to be located at the directory "myApp"
        r.add("/admin/", {location: { scriptName: "/control", dir: "my"})

        //  Rewrite a request for "old.html" to new.html
        r.add("/web/old.html", 
            {rewrite: function(request) { request.pathInfo = "/web/new.html"}})  

        //  Handle a request with a literal response
        r.add("/oldStuff/", {response: {body: "Not found"} })

        //  Handle a request with an inline function
        r.add("/oldStuff/", {response: function(request) { return {body: "Not found"} }})

        //  A custom matching function to match SSL requests
        r.add(function (request) {
            if (request.scheme == "https") {
                request.params["security"] = "high"
                return true
            }, {
                name: "secure", action: "private" 
            }
        })

        //  A matching function that rewrites a request and then continues matching other routes
        r.add(function (request) {
            if (request.uri.startsWith("/old")) {
                request.uri = request.uri.toString().trimStart("/old")
                return false
            }
        })

        //  Route based on header values
        r.add(function (request) {
            if (request.header("user-agent").contains("Chrome")) {
                return true
            }
        })

        //  Set request parameters with values from request
        r.add("/custom", {action: "display", params: { from: "{uri}", transport: "{scheme}" })

        //  Nest matching routes
        let outer = r.add("/blog", {target: "/post/index"})
        r.add("/comment", {target: "/comment/{action}/{id}", outer: outer})

        //  Match with regular expression. The sub-match is available via $N parameters
        r.add(/^\/Dash-((Mini)|(Full))$/, 
            {controller: "post", action: "list", params: {kind: "$1"}}
        )
        
        //  Conditional matching. Surround optional tokens in "()"
        r.add("/Dash(/{product}(/{branch}(/{configuration})))", {   
            name: "dash", 
            method: "POST", 
            controller: "Dash", 
            action: "index",
        })

        //  Replace the home page route
        r.addHome("/Status")

        //  Display the route table to the console
        r.show()

        @stability prototype
        @spec ejs
     */
    class Router {

        /**
            Symbolic constant for Router() to add top-level routes for directory, *.es, *.ejs and a catchall 
            route for static pages. 
            Use of this constant will not add routes for MVC content or RESTful resources. 
         */ 
        public static const Top: String = "top"

        public static const WebSite: String = "webSite"

        /**
            Max calls to route() per request
         */
        static const MaxRoute = 20

        /**
            Symbolic constant for Router() to add top-level routes for directory, *.es, *.ejs, generic routes for
            RESTful resources and a catchall route for static pages
         */ 
        public static const Restful: String = "restful"

        /**
            Default application to use when unspecified by a route
         */
        public var defaultApp: Function = MvcApp

        /* Router options provide to constructor */
        private var routerOptions: Object

        /**
            Routes indexed by first component of the URI path/template
         */
        public var routes: Object = {}
        
        /**
            Function to test if the Request.filename is a directory.
            @param request Request object to consider
            @return True if request.filename is a directory
         */
        public static function isDir(request) request.filename.isDir

        /**
            Add a catch-all route for static content
         */
        public function addCatchall(): Void
            add(/^\/.*$/, {name: "catchall", response: StaticApp, method: "*"})

        /**
            Add a default MVC controller/action route. This consists of a "/{controller}/{action}" route.
            All HTTP method verbs are supported.
         */
        public function addDefault(response: Object): Void
            add("/{controller}(/{action}(/.*))", {name: "default", method: "*", response: response})

        /**
            Add routes to handle static content, directories, "es" scripts and stand-alone ejs templated pages.
         */
        public function addHandlers(): Void {
            let staticPattern = "\/" + (App.config.dirs.static.basename || "static") + "\/.*"
            //  TODO - why test here?
            if (staticPattern) {
                add(staticPattern, {name: "default", response: StaticApp})
            }
/*  FUTURE
            add(/\.html$|\.css$|\.jpg$|\.gif$|\.png$|\.ico$|\.css$|\.js$/i,  {name: "static",  response: StaticApp})
 */
            add(/\.es$/i,  {name: "es",  response: ScriptApp, method: "*"})
            add(/\.ejs$/i, {name: "ejs", module: "ejs.template", response: TemplateApp, method: "*"})
            add(isDir,    {name: "dir", response: DirApp})
        }

        /**
            Add a home page route. This will add or update the "home" page route.
            @param target Target to invoke when the home page is accessed.
         */
        public function addHome(target: Object): Void
            add("/", { name: "home", target: target})

        /**
            Add restful routes for a singleton resource. 
            Supports member CRUD actions: edit, show, update, and custom actions.
            The restful routes defined are:
            <pre>
                Method  URL                   Action
                GET     /controller/edit      edit        Display a resource form suitable for editing
                GET     /controller           show        Display a resource (not editable)
                PUT     /controller           update      Update a resource (idempotent)
                ANY     /controllers/action   *           Other custom actions
            </pre>
            The default route is used when constructing URIs via Request.link.
            @param name Name of the resource to route. Can also be an array of names.
         */
        public function addResource(name: *): Void {
            if (name is Array) {
                for each (n in name) {
                    addResource(n)
                }
                return
            } 
            add('/' + name + "/edit",      {controller: name, action: "edit"})
            add('/' + name,                {controller: name, action: "show"})
            add('/' + name,                {controller: name, action: "update", method: "PUT"})
            add('/' + name + "/{action}",  {controller: name, name: "default",  method: "*"})
        }

        /** 
            Add restful routes for a resource collection. 
            Supports CRUD actions: edit, index, show, create, update, destroy. The restful routes defined are:
            <pre>
                Method  URL                     Action
                GET     /controller             index       Display an overview of the resource
                GET     /controller/init        init        Initialize and display a blank form for a new resource
                POST    /controller             create      Accept a form creating a new resource

                GET     /controller/1/edit      edit        Display a resource form suitable for editing
                GET     /controller/1           show        Display a resource (not editable)
                PUT     /controller/1           update      Update a resource (idempotent)
                DELETE  /controller/1           destroy     Destroy a resource (idempotent)

                ANY     /controller/action      default     Other custom actions
            </pre>
            The default route is used when constructing URIs via Request.link.
            @param name Name of the resource to route. Can also be an array of names.
        */
        public function addResources(name: *): Void {
            if (name is Array) {
                for each (n in name) {
                    addResources(n)
                }
                return
            } 
            add('/' + name + "/init",       {controller: name, action: "init"})
            add('/' + name,                 {controller: name, action: "index"})
            add('/' + name,                 {controller: name, action: "create", method: "POST"})

            let id = {id: "[0-9]+"}
            add('/' + name + "/{id}/edit",  {controller: name, action: "edit", constraints: id})
            add('/' + name + "/{id}",       {controller: name, action: "show", constraints: id})
            add('/' + name + "/{id}",       {controller: name, action: "update", , constraints: id, method: "PUT"})
            add('/' + name + "/{id}",       {controller: name, action: "destroy", , constraints: id, method: "DELETE"})

            add('/' + name + "/{action}",   {controller: name, name: "default", method: "*"})
        }

        /** 
            Add default restful routes for resources. This adds default routes for generic resources.
            Supports CRUD actions: edit, index, show, create, update, destroy. The restful routes defined are:
            <pre>
                Method  URL                     Action
                GET     /controller             index       Display an overview of the resource
                GET     /controller/init        init        Initialize and display a blank form for a new resource
                POST    /controller             create      Accept a form creating a new resource

                GET     /controller/1/edit      edit        Display a resource form suitable for editing
                GET     /controller/1           show        Display a resource (not editable)
                PUT     /controller/1           update      Update a resource (idempotent)
                DELETE  /controller/1           destroy     Destroy a resource (idempotent)

                ANY     /controller/action      default     Other custom actions
            </pre>
            The default route is used when constructing URIs via Request.link.
        */
        public function addRestful(): Void {
            add("/{controller}/init",               {action: "init"})
            add("/{controller}",                    {action: "index"})
            add("/{controller}",                    {action: "create", method: "POST"})

            let id = {id: "[0-9]+"}
            add("/{controller}/{id}/edit",          {action: "edit", constraints: id})
            add("/{controller}/{id}",               {action: "show", constraints: id})
            add("/{controller}/{id}",               {action: "update", constraints: id, method: "PUT"})
            add("/{controller}/{id}",               {action: "destroy", constraints: id, method: "DELETE"})

            //  Same as addDefault()
            add("/{controller}(/{action})",         {name: "default", method: "*"})
        }

        /**
            Create a Router instance and initialize routes.
            @param routeSet Optional name of the route set to add. Supports sets include:
                Router.Top and Router.Restful. The Top routes provide top level routes for pages with extensions ".ejs", 
                and ".es" as well as for static content (see $addHandlers, $addCatchall). The Restful routes provide 
                default Controller/Action routes according to a RESTful paradigm (see $addRestful). The routeSet can
               also be set to null to add not routes. This is useful for creating a bare Router instance. Defaults 
               to Top.
            @param options Options to apply to all routes
            @option workers Boolean If true, requests should be execute in a worker thread if possible. The worker thread 
                will be pooled when the request completes and will be available for subsequent requests.  
           @throws Error for an unknown route set.
         */
        function Router(routeSet: String? = Restful, options: Object = {}) {
            routerOptions = options
            switch (routeSet) {
            case Top:
                addHandlers()
                addDefault(StaticApp)
                addCatchall()
                break
            case Restful:
                addHome("@Base/")
                add("/favicon.ico", { redirect: "/static/images/favicon.ico" })
                addHandlers()
                addRestful()
                addCatchall()
                break
            case WebSite:
                add(/\.es$/i,  {name: "es",  response: ScriptApp, method: "*"})
                add(/\.ejs$/i, {name: "ejs", module: "ejs.template", response: TemplateApp, method: "*"})
                add(isDir,    {name: "dir", response: DirApp})
                addCatchall()
            case null:
                break
            default:
                throw new ArgError("Unknown route set: " + routeSet)
            }
        }

        private function insertRoute(r: Route): Void {
            let routeSet = routes[r.routeSetName] ||= {}
            routeSet[r.name] = r
            if (r.workers == null) {
                r.workers = routerOptions.workers
            }
        }

        /**
            Add a route
            @param template String or Regular Expression defining the form of a matching URI (Request.pathInfo).
                If options are not provided and the template arg is a string starting with "\@", the template is
                interpreted both as a URI and as providing the options. See $options below for more details.
            @param options Route options representing the URI and options to use when servicing the request. If it
                is a string, it may begin with a "\@" and be of the form "\@[controller/]action". In this case, if there
                is a "/" delimiter, the first portion is a controller and the second is the controller action to invoke.
                The controller or action may be absent. For example: "\@Controller/", "\@action", "\@controller/action".
                If the string does not begin with an "\@", it is interpreted as a literal URI. 
                For example: "/web/index.html". If the options is an object hash, it may contain the options below:
            @option action Action method to service the request if using controllers. This may also be of the form 
                "controller/action" to set both the action and controller in one property.
            @option constraints Object Object hash of properties whose values are constrained. The property names are
                the field names to be constrained and their values are regular expressions for which the actual URI
                values must match for the route to match.
            @option controller Controller to service the request.
            @option name Name to give to the route. If absent, the name is created from the controller and action names.
                The route naming rules are:
                1. Use options.name if provided, else
                2. Use any action name, else
                3. Use "index"
                The action name is sleuthed from the template if no options are given.
            @option outer Parent route. The parent's template and parameters are appended to this route.
            @option params Override parameter to provide to the request in the Request.params.
            @examples:
                Route("/{controller}(/{action}(/{id}))/", { method: "POST" })
                Route("/User/login", {name: "login" })
                Route("\@/User/login")
            @option name Name for the route
            @option method String|RegExp HTTP methods to support.
            @option limits Limits object for the requests on this route. See HttpServer.limits.
            @option location Application location to serve the request. Location contains two properties: scriptName 
                which is the string URI prefix for the application and dir which is a Path to the physical file system 
                directory containing the applciation.
            @option params Override request parameters.
            @option parent Outer parent route
            @option redirect Redirect requests on this route to this URI.
            @option response (Function|Object) This can be either a function to serve the request or it can be a response 
                hash with status, headers and body properties. The function should have this signature:
                    function (request: Request): Object
            @option rewrite Rewrite function. This can rewrite request properties.
            @option set Route set name in which to add this route. Defaults to the first component of the template if
                the template is a string, otherwise "".
            @option target Target for the route. This can be a Uri path or a controller/action pair: "\@[controller/]action".
            @example:
                r.add("/User/{action}", {controller: "User"})
         */
        public function add(template: Object, options: Object? = null): Route {
            let r = new Route(template, options, this)
            insertRoute(r)
            return r
        }

        /**
            Lookup a route by name. The route name is determined by the options provided when the route was created.
            Action names will be sleuthed from the template if no options provided.
            Outer routes are pre-pended if defined.
            @param options Route description. This can be either string or object hash. If it is a string, it should be
                of the form "controller/action". If the options is an object hash, it should have properties
                controller and action. The controller is used as the index for the route set. The action property is
                the index for the route name.
            @return Route object or null if the route is not found
         */
        public function lookup(options: Object): Route? {
            if (options is String) {
                if (options[0] == "@") {
                    options = options.slice(1)
                }
                if (options.contains("/")) {
                    let [controller, action] = options.split("/")
                    let routeSet = routes[controller]
                    if (routeSet) {
                        return routeSet[action]
                    }
                }
                return routes[""][options]
            }
            let controller = options.controller || ""
            let routeSet = routes[controller]
            let routeName = options.route || options.action || "default"
            return routeSet[routeName]
        }

        /**
            Remove a route
            @param name Name of the route to remove. Name should be of the form "controller/action" where controller
            is the index for the route set and action is the index for the route name.
         */
        public function remove(name: String): Void {
            let [controller, action] = name.split("/")
            let routeSet = routes[controller]
            for (let routeName in routeSet) {
                if (routeName == action) {
                    delete routeSet[action]
                    return
                }
            }
            throw "Cannot find route \"" + name + "\" to remove"
        }

        /**
            Reset the request routing table by removing all routes
         */
        public function reset(request): Void {
            routes = {}
        }

        private function reroute(request): Route {
            request.routed ||= 1
            if (request.routed++ > MaxRoute) {
                throw "Too many route calls. Route table may have a loop."
            }
            return route(request)
        }

        private function secondStageRoute(request: Request, r: Route): Route {
            let params = request.params
            let pathInfo = request.pathInfo
            let log = request.log

            for (field in r.params) {
                /*  Apply override params */
                let value = r.params[field]
                if (value.toString().contains("$")) {
                    value = pathInfo.replace(r.pattern, value)
                }
                if (value.toString().contains("{")) {
                    value = Uri.templateString(value, params, request)
                }
                params[field] = value
            }
            if (r.rewrite && !r.rewrite(request)) {
                log.debug(5, "Request rewritten as \"" + request.pathInfo + "\" (reroute)")
                return reroute(request)
            }
            if (r.redirect) {
                //  TODO OPT - could this this via a custom app function
                request.pathInfo = r.redirect
                log.debug(5, "Route redirected to \"" + request.pathInfo + "\" (reroute)")
                return reroute(request)
            }
            let location = r.location
            if (location && location.scriptName && location.scriptName != request.scriptName && location.dir) {
                request.setLocation(location.scriptName, location.dir)
                log.debug(4, "Set location scriptName \"" + location.scriptName + "\" dir \"" + 
                    location.dir + "\" (reroute)")
                return reroute(request)
            }
            if (r.module && !r.initialized) {
                global.load(r.module + ".mod")
                r.initialized = true
            }
            if (log.level >= 3) {
                log.debug(5, "Matched route \"" + r.routeSetName + "/" + r.name + "\"")
                if (log.level >= 5) {
                    log.debug(5, "  Route params " + serialize(params, {pretty: true}))
                }
                if (log.level >= 6) {
                    log.debug(6, "  Route " + serialize(r, {pretty: true}))
                    log.debug(6, "  REQUEST\n" + serialize(request, {pretty: true}))
                }
            }
            if (r.limits) {
                request.setLimits(r.limits)
            }
            if (r.trace) {
                request.trace(r.trace.level || 0, r.trace.options, r.trace.size)
            }
            request.route = r
            return r
        }

        /** 
            Route a request. The request is matched against the configured route table. 
            The call returns the web application to execute.
            @param request The current request object
            @return The web application function of the signature: 
                function app(request: Request): Object
         */
        public function route(request): Route {
            let log = request.log
            log.debug(5, "Routing " + request.pathInfo)

            //  TODO - this is now done by http for "-http-method" and X-HTTP-METHOD-OVERRIDE
            if (request.method == "POST") {
                let method = request.params["-ejs-method-"] || request.header("X-HTTP-METHOD-OVERRIDE")
                if (method && method.toUpperCase() != request.method) {
                    log.debug(3, "Change method from " + request.method + " TO " + method + " for " + request.uri)
                    request.method = method
                }
            }
            let routeSet = routes[request.pathInfo.split("/")[1]]
            for each (r in routeSet) {
                log.debug(5, "Test route \"" + r.name + "\"")
                if (r.match(request)) {
                    return secondStageRoute(request, r)
                }
            }
            routeSet = routes[""]
            for each (r in routeSet) {
                log.debug(5, "Test route \"" + r.name + "\"")
                if (r.match(request)) {
                    return secondStageRoute(request, r)
                }
            }
            throw "No route for " + request.pathInfo
        }

        /**
            Set the default application function for the route
            @hide
         */
        public function setDefaultApp(app: Function): Void
            defaultApp = app

        //  TODO - rethink the "full" arg
        /**
            Show the route table
            @param extra Set to "full" to display extra route information
         */
        public function show(extra: String? = null): Void {
            let lastController
            for each (name in Object.getOwnPropertyNames(routes).sort()) {
                print("\n" + (name || "Global")+ "/")
                for each (r in routes[name]) {
                    showRoute(r, extra)
                }
            }
            print()
        }

        private function showRoute(r: Route, extra: String? = null): Void {
            let method = r.method || "*"
            let target
            let tokens = r.tokens
            let params = r.params || {}
            if (params.controller || params.action || 
                    (tokens && (tokens.contains("action") || tokens.contains("controller")))) {
                let controller = params.controller || "*"
                let action = params.action || "*"
                target = controller + "/" + action
            } else if (r.response) {
                if (r.response is Function) {
                    target = r.response.name
                } else {
                    target = "Response Object"
                }
            } else {
                target = "UNKNOWN"
            }
            let template = r.template
            if (template is String) {
                template = "%s  " + template
            } else if (template is RegExp) {
                template = "%r  " + template
            } else if (template is Function) {
                template = "%f  " + template.name
            } else if (!template) {
                template = "*"
            }
            let line = "  %-24s %s %-24s %-7s %s".format(r.name, r.workers ? "W": " ", target, method, template)
            if (extra == "full") {
                if (params && Object.getOwnPropertyCount(params) > 0) {
                    if (!(params.action && Object.getOwnPropertyCount(params) == 1)) {
                        line += "\n                                                      %s".format(serialize(params))
                    }
                }
                line += "\n                                                      pattern: " + r.pattern + "\n"
            }
            print(line)
        }
    }

    /** 
        A Route describes a mapping from a URI to a web application. A route has a URI template for matching with
        candidate request URIs and a serving function to respond to the request.

        If the URI template is a regular expression, it is used to match against the request pathInfo. If it matches,
        the pathInfo is matched and sub-expressions may be referenced in the override parameters by using $1, $2 and
        so on. e.g. { priority: "$1" }
        
        If the URL template is a function, it is run to test for a request match. It should return true to 
        accept the request. The function can set parameters in request.params.

        The optional override params hash provides parameters which will be defined in params[] overriding any tokenized 
        parameters previously set.
     */
    enumerable dynamic class Route {
        use default namespace public

        /* 
            Seed for generating route names 
         */
        private static var nameSeed: Number = 0

        /**
            Resource limits for the request. See HttpServer.limits for details.
         */
        var limits: Object

        /**
            Application location to serve the request. Location contains two properties: scriptName which is the string 
            URI prefix for the application and dir which is a Path to the physical file system directory containing 
            the applciation.
         */
        var location: Object

        /**
            HTTP method to match. If set to "" or "*", all methods are matched.
         */
        var method: String

        /**
            Middleware to run on requests for this route. Middleware wraps the application function filtering and 
            modifying its inputs and outputs.
         */
        var middleware: Array

        /**
            Route name. This is local to the route set (controller)
         */
        var name: String?

        /**
            Name of a required module containing code to serve requests on this route.  
         */
        var moduleName: String?

        /**
            Original template as supplied by caller
         */
        private var originalTemplate: Object

        /**
            Outer route for a nested route. A nested route prepends the outer route template to its template. 
            The param set of the outer route is appended to the inner route.
            @hide
         */
        var outer: Route

        /**
            Request parameters to add to the Request.params. This optional override hash provides parameters which will 
            be defined in Request.params[].
         */
        var params: Object

        /**
            Rewrite function to rewrite the request before serving. It may update the request scriptName, pathInfo 
            and other Request properties. Return true to continue serving the request on this route. Otherwise re-route
            after rewriting the request. 
         */
        var rewrite: Function?

        /**
            URI to redirect the request toward.
         */
        var redirect: String?

        /**
            Response object hash or function to serve the request
         */
        var response: Object

        /** 
          Router instance reference
         */
        var router: Router

        /**
            Route set owning the route. This is the first component of the template.
         */
        var routeSetName: String?

        /**
            Target mapping for the route. The route maps from the template to the target.
         */
        var target: String?

        /**
            Template pattern for creating links. The template is used to match the request pathInfo. The template can be a 
            string, a regular expression or a function. If it is a string, it may contain tokens enclosed in braces 
            "{}" and it is converted to a regular expression for fast matching. At run-time, request tokens 
            are extracted and stored as items in the Request.params collection.

            If the template is a regular expression, it is used to match against the request pathInfo. If it matches, 
            then sub-expressions may be referenced in the $params values by using $1, $2 and so on. 
            e.g. params: { priority: "$1" }
            
            If the template is a function, it is run to test for a request match. The function should return true to 
            match the request. The function can directly set parameters in request.params.
        */
        var template: Object

        /**
            If true, requests should execute using a worker thread if possible. The worker thread will be pooled when
            the request completes and be available for use by subsequent requests.
         */
        var workers: Boolean?

        /**
            Key tokens in the route template
         */
        var tokens: Array?

        /**
            Trace options for the request. Note: the route is created after the Request object is created so the tracing 
            of the connections and request headers will be controlled by the owning server. 
            See HttpServer.trace for trace property fields.
         */
        var trace: Object

        /*
            Match function
         */
        internal var match: Function

        /*
            Regular expression pattern. This matches the pathInfo for the route.
         */
        internal var pattern: Object

        /*
            Splitter. This is used as the replacement argument to extract tokens from the pathInfo
         */
        internal var splitter: String

        /**
            Create a new Route instance. This is normally not invoked directly. Rather Router.add() is used to
            create and install routes into the Router.
            @param template String or Regular Expression defining the form of a matching URI (Request.pathInfo).
            @param options Route options representing the URI and options to use when servicing the request. If it
                is a string, it may begin with an "\@" and be of the form "\@[controller/]action". In this case, if there
                is a "/" delimiter, the first portion is a controller and the second is the controller action to invoke.
                The controller or action may be absent. For example: "\@Controller/", "\@action", "\@controller/action".
                If the string does not begin with an "\@", it is interpreted as a literal URI. 
                For example: "/web/index.html". If the options is an object hash, it may contain the options below:
            @option action Action method to service the request. This may be of the form "action", "controller/action" or 
                "controller/".  If the action portion omitted, the default action (index) will be used.
            @option controller Controller to service the request.
            @option method HTTP Method for which the route is valid. Set to "*" for all methods.
            @option name Name to give to the route. If absent, the name is created from the controller and action names.
            @option outer Parent route. The parent's template and parameters are appended to this route.
            @option params Override parameter to provide to the request in the Request.params.
            @param router Owning router object
            @examples:
                Route("/{controller}(/{action}(/{id}))/", { method: "POST" })
                Route("/User/login", {name: "login" })
         */
        function Route(template: Object, options: Object, router: Router) {
            this.router = router
            this.template = template
            options = parseOptions(options)
            makeParams(options)
            inheritRoutes(options)
            compileTemplate(options)
            setName(options)
            setRouteSetName(options)
            setRouteProperties(options)
        }

        /**
            Get the template pattern for a route given a controller and a route name. If the specified controller 
            cannot be found, the Global route set is used. If the specified route name cannot be found, the "default"
            route is used. Use Uri.template to expand the template with URI components.
            @param controller Controller name
            @param routeName Route name to look for
            @return A template URI string
            @hide
         */
        public function getTemplate(controller: String~, routeName: String~): String {
            let routes = router.routes
            let routeSet = routes[controller] || routes[""]
            let route = routeSet[routeName] || routeSet["default"] || routes[""]["default"]
            return "/{scriptName}" + route.template
        }

        private function inheritRoutes(options: Object): Void {
            let parent = options.outer
            if (parent) {
                let ptem = (parent.originalTemplate is RegExp) ? parent.originalTemplate.source : parent.originalTemplate
                let tem = (template is RegExp) ? template.source : template
                if (template is RegExp) {
                    template = RegExp(ptem + tem)
                } else {
                    template = ptem + tem
                }
                for (p in parent.params) {
                    params[p] ||= parent.params[p]
                }
            }
            this.originalTemplate = template
        }

        //  TODO - see ESP. It does this a better way

        private function compileTemplate(options: Object): Void {
            if (template is String) {
                let t = template
                /*  
                    For string templates, Create a regular expression splitter template so :TOKENS can be referenced
                    positionally in the override hash via $N args.
                    Allow () expressions, these are made into non-capturing parentheses.
                 */
                if (t.contains("(")) {
                    t = t.replace(/\(/g, "(?:")
                    t = t.replace(/\)/g, ")?")
                }
                tokens = t.match(/\{([^\}]+)\}/g)
                for (i in tokens) {
                    tokens[i] = tokens[i].trimStart('{').trimEnd('}')
                }
                let constraints = options.constraints
                for each (token in tokens) {
                    if (constraints && constraints[token]) {
                        t = t.replace("{" + token + "}", "(" + constraints[token] + ")")
                    } else {
                        t = t.replace("{" + token + "}", "([^/]*)")
                    }
                } 
                //  TODO - is this required?
                t = t.replace(/\//g, "\\/")
                pattern = RegExp("^" + t + "$")
                /*  Splitter ends up looking like "$1:$2:$3:$4" */
                let count = 1
                if (!splitter) {
                    splitter = ""
                    for (c in tokens) {
                        splitter += "$" + count++ + ":"
                    }
                    splitter = splitter.trim(":")
                }
                match = matchAndSplit
                template = template.replace(/[\(\)]/g, "").replace(/\/\.\*/g, "")
            } else {
                if (template is Function) {
                    match = template
                } else if (template is RegExp) {
                    pattern = template
                    match = matchRegExp
                } else if (template) {
                    pattern = RegExp(template.toString())
                    match = matchRegExp
                }
            }
        }

        /*
            Match a request and apply splitter to create request params
         */
        private function matchAndSplit(request: Request): Boolean {
            if (method && !request.method.contains(method)) {
                return false
            }
            let pathInfo = request.pathInfo
            if (!pathInfo.match(pattern)) {
                return false
            }
            let parts = pathInfo.replace(pattern, splitter).split(":")
            for (i in tokens) {
                request.params[tokens[i]] ||= parts[i].trimStart("/")
            }
            return true
        }

        /*
            Match a request using a regular expression without splitter
         */
        private function matchRegExp(request: Request): Boolean~ {
            if (method && !request.method.contains(method)) {
                return false
            }
            return request.pathInfo.match(pattern)
        }

        /*
            Make the params object based on input options
         */
        private function makeParams(options: Object): Void {
            params = options.params || {}
            if (options.action) {
                params.action = options.action
            }
            if (options.controller) {
                params.controller = options.controller
            }
            if (options.namespace) {
                params.namespace = options.namespace
            }
        }

        /*
            If no options provided, sleuth the action from the template. This will probably also end up setting 
            the name to the action component
         */
        private function parseOptions(options: Object): Object {
            if (!options) {
                if (template is String) {
                    if (template[0] == '@') {
                        let t = template.replace(/[\(\)]/g, "")
                        options = {target: t.split("{")[0]}
                        template = template.trimStart("@")
                    }
                }
                options ||= {}
            } else if (options is String) {
                options = {target: options}
            }
            target = options.target
            if (target) {
                if (target[0] == '@') {
                    if (target.contains("/")) {
                        [options.controller, options.action] = target.slice(1).trimStart("/").split("/")
                    } else {
                        options.action = target.slice(1)
                    }
                }
            }
            if (options.action) {
                if (options.action.contains("/")) {
                    [options.controller, options.action] = options.action.trimStart("/").split("/")
                } 
                if (options.action.contains("::")) {
                    [options.namespace, options.action] = options.action.split("::")
                }
            }
            if (options.middleware) {
                middleware = options.middleware.reverse()
            }
            return options
        }

        /*
            Create a useful (deterministic) name for the route. Rules are:
            1. Use options.name if provided, else
            2. Use any action name, else
            3. Use "default"

            Action names will be sleuthed from the template if no options provided.
            Outer routes are pre-pended if defined.
         */
        private function setName(options: Object): Void {
            name = options.name
            if (!name && options.action) {
                name = options.action
            }
            if (!name) {
                if (template is String) {
                    /* Take second component */
                    name = template.split("{")[0].split("/")[2]
                } else if (template is Function) {
                    name = template.name
                }
            }
            name ||= "default"
            if (outer && !options.name) {
                name = options.name + "/" + name
            }
            if (!name) {
                throw "Route has no name defined"
            }
        }

        private function setRouteSetName(options: Object): Void {
            if (options) {
                routeSetName = options.set
            }
            if (!routeSetName && template is String) {
                routeSetName = template.split("{")[0].split("/")[1]
            }
            routeSetName ||= ""
        }

        private function setRouteProperties(options: Object): Void {
            limits = options.limits
            linker = options.linker
            location = options.location
            moduleName = options.module
            rewrite = options.rewrite
            redirect = options.redirect
            workers = options.workers
            trace = options.trace
            if (options.method == "" || options.method == "*") {
                method = options.method = ""
            } else {
                method = options.method || "GET"
            }
            options.response ||= router.defaultApp
            if (!(options.response is Function)) {
                response = function (request) {
                    return options.response
                }
            } else {
                response = options.response
            }
        }

    }
}

/*
    @copy   default

    Copyright (c) Embedthis Software. All Rights Reserved.

    This software is distributed under commercial and open source licenses.
    You may use the Embedthis Open Source license or you may acquire a 
    commercial license from Embedthis Software. You agree to be fully bound
    by the terms of either license. Consult the LICENSE.md distributed with
    this software for full details and other copyrights.

    Local variables:
    tab-width: 4
    c-basic-offset: 4
    End:
    vim: sw=4 ts=4 expandtab

    @end
 */
