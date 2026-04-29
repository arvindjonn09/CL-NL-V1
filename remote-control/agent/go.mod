module remote-control-agent

go 1.22.2

require github.com/gorilla/websocket v1.5.3

require github.com/google/uuid v1.6.0

require github.com/Microsoft/go-winio v0.6.2

require setulinkpaths v0.0.0

require (
	golang.org/x/image v0.24.0
	golang.org/x/sys v0.30.0
)

replace setulinkpaths => ../shared/setulinkpaths
