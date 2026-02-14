package com.example.frontend.controller;

import com.example.frontend.model.BatchDeleteRequest;
import com.example.frontend.model.BatchDeleteResponse;
import com.example.frontend.model.PageData;
import com.example.frontend.service.WebServerClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/pages")
public class PageController {

    private final WebServerClient webServerClient;

    public PageController(WebServerClient webServerClient) {
        this.webServerClient = webServerClient;
    }

    @GetMapping("/dashboard")
    public ResponseEntity<PageData> getDashboardPage() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("stats", webServerClient.getDashboardStats());
        data.put("recentDevices", webServerClient.getDashboardDevices());
        return ResponseEntity.ok(new PageData("Dashboard", data));
    }

    @GetMapping("/devices")
    public ResponseEntity<PageData> getDevicesPage() {
        Object devices = webServerClient.getDashboardDevices();
        return ResponseEntity.ok(new PageData("Devices", devices));
    }

    @GetMapping("/devices/{id}")
    public ResponseEntity<PageData> getDeviceDetailsPage(@PathVariable String id) {
        Object device = webServerClient.getDeviceDetails(id);
        if (device != null) {
            return ResponseEntity.ok(new PageData("Device Details", device));
        }
        return ResponseEntity.notFound().build();
    }

    @DeleteMapping("/devices/{id}")
    public ResponseEntity<Void> deleteDevice(@PathVariable String id) {
        webServerClient.deleteDevice(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/devices/batch-delete")
    public ResponseEntity<BatchDeleteResponse> batchDeleteDevices(@RequestBody BatchDeleteRequest request) {
        BatchDeleteResponse response = webServerClient.batchDeleteDevices(request);
        return ResponseEntity.ok(response);
    }

    // User management endpoints
    @GetMapping("/users")
    public ResponseEntity<PageData> getUsersPage() {
        Object users = webServerClient.getAllUsers();
        return ResponseEntity.ok(new PageData("Users", users));
    }

    @GetMapping("/users/{id}")
    public ResponseEntity<PageData> getUserDetailsPage(@PathVariable String id) {
        Object user = webServerClient.getUserDetails(id);
        if (user != null) {
            return ResponseEntity.ok(new PageData("User Details", user));
        }
        return ResponseEntity.notFound().build();
    }

    @PostMapping("/users")
    public ResponseEntity<Object> createUser(@RequestBody Object user) {
        Object createdUser = webServerClient.createUser(user);
        return ResponseEntity.ok(createdUser);
    }

    @PutMapping("/users/{id}")
    public ResponseEntity<Void> updateUser(@PathVariable String id, @RequestBody Object user) {
        webServerClient.updateUser(id, user);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/users/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable String id) {
        webServerClient.deleteUser(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/users/batch-delete")
    public ResponseEntity<BatchDeleteResponse> batchDeleteUsers(@RequestBody BatchDeleteRequest request) {
        BatchDeleteResponse response = webServerClient.batchDeleteUsers(request);
        return ResponseEntity.ok(response);
    }

    // Interface management endpoints
    @GetMapping("/interfaces")
    public ResponseEntity<PageData> getInterfacesPage(
            @RequestParam(required = false) String deviceId,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean enabled,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer pageSize) {

        Map<String, String> queryParams = new HashMap<>();
        if (deviceId != null) queryParams.put("deviceId", deviceId);
        if (type != null) queryParams.put("type", type);
        if (status != null) queryParams.put("status", status);
        if (enabled != null) queryParams.put("enabled", enabled.toString());
        if (page != null) queryParams.put("page", page.toString());
        if (pageSize != null) queryParams.put("pageSize", pageSize.toString());

        Object interfaces = webServerClient.getAllInterfaces(queryParams);
        return ResponseEntity.ok(new PageData("Device Interfaces", interfaces));
    }
}
