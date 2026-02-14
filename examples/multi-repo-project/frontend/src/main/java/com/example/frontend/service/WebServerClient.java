package com.example.frontend.service;

import com.example.frontend.model.BatchDeleteRequest;
import com.example.frontend.model.BatchDeleteResponse;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

@Service
public class WebServerClient {

    private final RestTemplate restTemplate;
    private final String webServerUrl;

    public WebServerClient() {
        this(new RestTemplate(), "http://localhost:8080");
    }

    // Constructor for testing
    WebServerClient(RestTemplate restTemplate, String webServerUrl) {
        this.restTemplate = restTemplate;
        this.webServerUrl = webServerUrl;
    }

    public Object getDashboardStats() {
        try {
            return restTemplate.getForObject(
                    webServerUrl + "/api/dashboard/stats", Object.class);
        } catch (Exception e) {
            return Collections.singletonMap("error", "web-server unavailable");
        }
    }

    @SuppressWarnings("unchecked")
    public Object getDashboardDevices() {
        try {
            return restTemplate.getForObject(
                    webServerUrl + "/api/dashboard/devices", Object[].class);
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    public void deleteDevice(String deviceId) {
        try {
            restTemplate.delete(webServerUrl + "/api/proxy/devices/" + deviceId);
        } catch (Exception e) {
            throw new RuntimeException("Failed to delete device: " + e.getMessage(), e);
        }
    }

    public BatchDeleteResponse batchDeleteDevices(BatchDeleteRequest request) {
        try {
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("device_ids", request.getDeviceIds());

            return restTemplate.postForObject(
                    webServerUrl + "/api/proxy/devices/batch-delete",
                    requestBody,
                    BatchDeleteResponse.class);
        } catch (Exception e) {
            throw new RuntimeException("Failed to batch delete devices: " + e.getMessage(), e);
        }
    }

    public Object getDeviceDetails(String deviceId) {
        try {
            return restTemplate.getForObject(
                    webServerUrl + "/api/proxy/devices/" + deviceId, Object.class);
        } catch (Exception e) {
            return null;
        }
    }

    // User management methods
    public Object getAllUsers() {
        try {
            return restTemplate.getForObject(
                    webServerUrl + "/api/proxy/users", Object[].class);
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    public Object getUserDetails(String userId) {
        try {
            return restTemplate.getForObject(
                    webServerUrl + "/api/proxy/users/" + userId, Object.class);
        } catch (Exception e) {
            return null;
        }
    }

    public Object createUser(Object user) {
        try {
            return restTemplate.postForObject(
                    webServerUrl + "/api/proxy/users", user, Object.class);
        } catch (Exception e) {
            throw new RuntimeException("Failed to create user: " + e.getMessage(), e);
        }
    }

    public void updateUser(String userId, Object user) {
        try {
            restTemplate.put(webServerUrl + "/api/proxy/users/" + userId, user);
        } catch (Exception e) {
            throw new RuntimeException("Failed to update user: " + e.getMessage(), e);
        }
    }

    public void deleteUser(String userId) {
        try {
            restTemplate.delete(webServerUrl + "/api/proxy/users/" + userId);
        } catch (Exception e) {
            throw new RuntimeException("Failed to delete user: " + e.getMessage(), e);
        }
    }

    public BatchDeleteResponse batchDeleteUsers(BatchDeleteRequest request) {
        try {
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("device_ids", request.getDeviceIds());

            return restTemplate.postForObject(
                    webServerUrl + "/api/proxy/users/batch-delete",
                    requestBody,
                    BatchDeleteResponse.class);
        } catch (Exception e) {
            throw new RuntimeException("Failed to batch delete users: " + e.getMessage(), e);
        }
    }

    // Interface management methods
    public Object getAllInterfaces(Map<String, String> queryParams) {
        try {
            StringBuilder url = new StringBuilder(webServerUrl + "/api/proxy/interfaces");

            if (queryParams != null && !queryParams.isEmpty()) {
                url.append("?");
                queryParams.forEach((key, value) -> {
                    if (value != null && !value.isEmpty()) {
                        url.append(key).append("=").append(value).append("&");
                    }
                });
                // Remove trailing &
                if (url.charAt(url.length() - 1) == '&') {
                    url.deleteCharAt(url.length() - 1);
                }
            }

            return restTemplate.getForObject(url.toString(), Object.class);
        } catch (Exception e) {
            return Collections.singletonMap("error", "Failed to fetch interfaces: " + e.getMessage());
        }
    }
}
