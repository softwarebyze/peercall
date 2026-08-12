// PeerCall signaling server — Go port of signal/protocol.ts.
//
// Speaks the exact same JSON protocol over WebSocket at /signal and serves
// the same ICE config at /config, so the React client works unchanged.
//
// Usage:
//
//	go run . [-port 8080]
//
// Env vars: SIGNAL_PORT, CORS_ORIGINS, TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
)

// ─── protocol types ───────────────────────────────────────────────────────────

type msg struct {
	T       string          `json:"t"`
	Payload json.RawMessage `json:"payload"`
}

type outMsg struct {
	T       string `json:"t"`
	Payload any    `json:"payload"`
}

type chatEntry struct {
	ID   string `json:"id"`
	From string `json:"from"`
	Name string `json:"name"`
	Text string `json:"text"`
	TS   int64  `json:"ts"`
}

type peerInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	IsHost bool   `json:"isHost"`
}

// ─── state ───────────────────────────────────────────────────────────────────

type peer struct {
	id   string
	name string
	conn *websocket.Conn
	mu   sync.Mutex // serializes writes
}

func (p *peer) send(t string, payload any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = wsjson.Write(ctx, p.conn, outMsg{T: t, Payload: payload})
}

type room struct {
	id     string
	peers  map[string]*peer
	order  []string // join order, for host transfer
	hostID string
	chat   []chatEntry
}

type server struct {
	mu    sync.Mutex
	rooms map[string]*room
}

func newServer() *server {
	return &server{rooms: make(map[string]*room)}
}

// ─── room logic (mirrors signal/protocol.ts) ─────────────────────────────────

func (r *room) peerList() []peerInfo {
	out := make([]peerInfo, 0, len(r.peers))
	for _, id := range r.order {
		if p, ok := r.peers[id]; ok {
			out = append(out, peerInfo{ID: p.id, Name: p.name, IsHost: p.id == r.hostID})
		}
	}
	return out
}

func (r *room) broadcastRoomState() {
	payload := map[string]any{"peers": r.peerList(), "chat": r.chat}
	for _, p := range r.peers {
		p.send("room_state", payload)
	}
}

// leaveRoom must be called with s.mu held.
func (s *server) leaveRoom(rm *room, p *peer) {
	delete(rm.peers, p.id)
	for i, id := range rm.order {
		if id == p.id {
			rm.order = append(rm.order[:i], rm.order[i+1:]...)
			break
		}
	}
	for _, other := range rm.peers {
		other.send("peer_left", map[string]any{"id": p.id})
	}
	if rm.hostID == p.id {
		rm.hostID = ""
		if len(rm.order) > 0 {
			rm.hostID = rm.order[0]
		}
	}
	if len(rm.peers) == 0 {
		delete(s.rooms, rm.id)
	} else {
		rm.broadcastRoomState()
	}
}

// ─── websocket handling ──────────────────────────────────────────────────────

func (s *server) handleWS(w http.ResponseWriter, req *http.Request) {
	conn, err := websocket.Accept(w, req, &websocket.AcceptOptions{
		// Origin is validated by corsMiddleware before we get here.
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	p := &peer{conn: conn}
	var joinedRoom *room

	defer func() {
		s.mu.Lock()
		if joinedRoom != nil && p.id != "" {
			if _, ok := joinedRoom.peers[p.id]; ok {
				s.leaveRoom(joinedRoom, p)
			}
		}
		s.mu.Unlock()
		conn.Close(websocket.StatusNormalClosure, "")
	}()

	ctx := req.Context()
	for {
		var m msg
		if err := wsjson.Read(ctx, conn, &m); err != nil {
			return
		}

		switch m.T {
		case "join":
			var pl struct {
				RoomID string `json:"roomId"`
				Name   string `json:"name"`
			}
			if err := json.Unmarshal(m.Payload, &pl); err != nil || pl.RoomID == "" || pl.Name == "" {
				p.send("error", map[string]any{"message": "roomId and name required"})
				continue
			}
			s.mu.Lock()
			rm, ok := s.rooms[pl.RoomID]
			if !ok {
				rm = &room{id: pl.RoomID, peers: make(map[string]*peer)}
				s.rooms[pl.RoomID] = rm
			}
			if len(rm.peers) >= 8 {
				s.mu.Unlock()
				p.send("error", map[string]any{"message": "room full (max 8)"})
				continue
			}
			p.id = uuid.NewString()
			p.name = pl.Name
			rm.peers[p.id] = p
			rm.order = append(rm.order, p.id)
			if rm.hostID == "" {
				rm.hostID = p.id
			}
			joinedRoom = rm
			p.send("joined", map[string]any{"id": p.id, "roomId": rm.id, "isHost": rm.hostID == p.id})
			for _, other := range rm.peers {
				if other.id != p.id {
					other.send("peer_joined", map[string]any{"id": p.id, "name": p.name, "isHost": false})
				}
			}
			rm.broadcastRoomState()
			s.mu.Unlock()

		case "offer", "answer", "ice":
			if joinedRoom == nil || p.id == "" {
				p.send("error", map[string]any{"message": "not joined"})
				continue
			}
			var pl struct {
				Target string          `json:"target"`
				Data   json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(m.Payload, &pl); err != nil {
				continue
			}
			s.mu.Lock()
			target := joinedRoom.peers[pl.Target]
			s.mu.Unlock()
			if target != nil {
				target.send(m.T, map[string]any{"from": p.id, "data": pl.Data})
			}

		case "chat":
			if joinedRoom == nil || p.id == "" {
				p.send("error", map[string]any{"message": "not joined"})
				continue
			}
			var pl struct {
				Text string `json:"text"`
			}
			if err := json.Unmarshal(m.Payload, &pl); err != nil {
				continue
			}
			if len(pl.Text) > 2000 {
				pl.Text = pl.Text[:2000]
			}
			entry := chatEntry{
				ID:   uuid.NewString(),
				From: p.id,
				Name: p.name,
				Text: pl.Text,
				TS:   time.Now().UnixMilli(),
			}
			s.mu.Lock()
			joinedRoom.chat = append(joinedRoom.chat, entry)
			if len(joinedRoom.chat) > 200 {
				joinedRoom.chat = joinedRoom.chat[len(joinedRoom.chat)-200:]
			}
			targets := make([]*peer, 0, len(joinedRoom.peers))
			for _, pp := range joinedRoom.peers {
				targets = append(targets, pp)
			}
			s.mu.Unlock()
			for _, pp := range targets {
				pp.send("chat", entry)
			}

		case "end_call":
			if joinedRoom == nil || p.id == "" {
				p.send("error", map[string]any{"message": "not joined"})
				continue
			}
			s.mu.Lock()
			if joinedRoom.hostID == p.id {
				for _, pp := range joinedRoom.peers {
					pp.send("call_ended", map[string]any{"by": p.id})
				}
				delete(s.rooms, joinedRoom.id)
			}
			s.mu.Unlock()
		}
	}
}

// ─── ICE config (mirrors buildIceConfig in signal/protocol.ts) ───────────────

func iceConfig() map[string]any {
	servers := []map[string]any{
		{"urls": "stun:stun.l.google.com:19302"},
		{"urls": "stun:stun1.l.google.com:19302"},
		{"urls": "stun:stun.cloudflare.com:3478"},
	}
	turnURLs := []string{}
	for _, u := range strings.Split(os.Getenv("TURN_URLS"), ",") {
		if u = strings.TrimSpace(u); u != "" {
			turnURLs = append(turnURLs, u)
		}
	}
	if len(turnURLs) > 0 {
		servers = append(servers, map[string]any{
			"urls":       turnURLs,
			"username":   os.Getenv("TURN_USERNAME"),
			"credential": os.Getenv("TURN_CREDENTIAL"),
		})
	} else {
		// Free Open Relay TURN fallback — keeps hard-NAT calls working at zero cost.
		servers = append(servers, map[string]any{
			"urls": []string{
				"turn:openrelay.metered.ca:80",
				"turn:openrelay.metered.ca:443",
				"turn:openrelay.metered.ca:443?transport=tcp",
			},
			"username":   "openrelayproject",
			"credential": "openrelayproject",
		})
	}
	return map[string]any{"iceServers": servers}
}

// ─── http server ─────────────────────────────────────────────────────────────

func allowedOrigins() []string {
	if env := os.Getenv("CORS_ORIGINS"); env != "" {
		parts := strings.Split(env, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			out = append(out, strings.TrimSpace(p))
		}
		return out
	}
	return []string{
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"http://localhost:4173",
		"http://127.0.0.1:4173",
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	origins := allowedOrigins()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			ok := false
			for _, o := range origins {
				if strings.HasPrefix(origin, o) {
					ok = true
					break
				}
			}
			if !ok {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	port := flag.String("port", "", "listen port (default $SIGNAL_PORT or 8080)")
	flag.Parse()
	addr := *port
	if addr == "" {
		addr = os.Getenv("SIGNAL_PORT")
	}
	if addr == "" {
		addr = "8080"
	}

	s := newServer()
	mux := http.NewServeMux()
	mux.HandleFunc("/signal", s.handleWS)
	mux.HandleFunc("/", s.handleWS) // parity with the Bun dev server
	mux.HandleFunc("/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(iceConfig())
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	log.Printf("PeerCall Go signaling server on ws://localhost:%s (config on /config)", addr)
	log.Fatal(http.ListenAndServe(":"+addr, corsMiddleware(mux)))
}
